import * as Y from 'yjs'
import { randomUUID } from 'node:crypto'
import { encodeDocument, fingerprint, loadDocument, normalizeConflicts, validateDocument, LIMITS, type Identity } from './document.js'
import { hash } from './hmac.js'
import { InternalFailure, type Pointer, type StorageApi } from './internal.js'

type Pending = { sequence: number; update: Uint8Array }
type Attempt = { pointer: Pointer; key: string; bytes: Uint8Array; sequence: number; fingerprint: string }
export type RoomOptions = { debounceMs: number; maxDelayMs: number; maxPendingBytes: number; maxPendingUpdates: number }
const defaults: RoomOptions = { debounceMs: 1000, maxDelayMs: 5000, maxPendingBytes: 24 * 1024 * 1024, maxPendingUpdates: 10000 }

/** Owns the accepted/durable waterlines. One immutable attempt is retained across response loss. */
export class Room {
  dirtySequence = 0
  durableSequence = 0
  paused = false
  frozen = false
  fenced = false
  pending: Pending[] = []
  pendingBytes = 0
  persistPromise?: Promise<void>
  private attempt?: Attempt
  private debounce?: NodeJS.Timeout
  private deadline?: NodeJS.Timeout
  private retry?: NodeJS.Timeout
  private failures = 0
  private conflicts = 0
  private disposed = false
  private acceptedHash: string
  private durableHash: string
  readonly options: RoomOptions
  constructor(public doc: Y.Doc, public pointer: Pointer, private api: StorageApi,
    private publish: (state: object) => void = () => {}, private closeConnections: () => void = () => {}, options: Partial<RoomOptions> = {}) {
    this.options = { ...defaults, ...options }
    this.acceptedHash = hash(Buffer.from(fingerprint(doc)))
    this.durableHash = this.acceptedHash
  }
  get identity(): Identity { return { projectId: this.pointer.projectId, epoch: this.pointer.epoch } }
  get memoryBytes(): number { return Y.encodeStateAsUpdate(this.doc).byteLength + this.pendingBytes + (this.attempt?.bytes.byteLength ?? 0) }
  /** Called synchronously after lease verification. No await between scratch validation and actual application. */
  accept(update: Uint8Array): void {
    if (this.paused || this.frozen || this.fenced || this.disposed) throw new InternalFailure('COLLAB_ROOM_READ_ONLY', 403)
    if (update.byteLength > LIMITS.updateBytes) throw new InternalFailure('COLLAB_UPDATE_TOO_LARGE', 413)
    if (this.pending.length >= this.options.maxPendingUpdates || this.pendingBytes + update.byteLength > this.options.maxPendingBytes)
      throw new InternalFailure('COLLAB_PENDING_LIMIT', 429)
    const current = encodeDocument(this.doc, this.identity), scratch = loadDocument(current, this.identity)
    try {
      Y.applyUpdate(scratch, update)
      // Unresolved dependencies can hide malicious structs until a later update. Fail closed and resync.
      if (scratch.store.pendingStructs || scratch.store.pendingDs) throw new InternalFailure('COLLAB_UPDATE_DEPENDENCY', 400)
      normalizeConflicts(scratch, this.identity)
      const acceptedHash = hash(encodeDocument(scratch, this.identity))
      if (acceptedHash === hash(current)) return
      // Include authoritative path repairs in the same accepted update.
      const bytes = Y.encodeStateAsUpdate(scratch, Y.encodeStateVector(this.doc))
      if (bytes.byteLength > LIMITS.updateBytes) throw new InternalFailure('COLLAB_UPDATE_TOO_LARGE', 413)
      if (this.pendingBytes + bytes.byteLength > this.options.maxPendingBytes) throw new InternalFailure('COLLAB_PENDING_LIMIT', 429)
      this.acceptedHash = hash(Buffer.from(fingerprint(scratch)))
      this.pending.push({ sequence: ++this.dirtySequence, update: bytes }); this.pendingBytes += bytes.byteLength
      // Register pending before Yjs emits its update (Hocuspocus broadcasts from this event).
      Y.applyUpdate(this.doc, bytes, 'gateway-accepted')
      this.publishState(); this.schedule()
    } catch (error) {
      if (error instanceof InternalFailure) throw error
      throw new InternalFailure('COLLAB_UPDATE_INVALID', 400)
    } finally { scratch.destroy() }
  }
  state(): object {
    return { type: 'persistence', projectId: this.pointer.projectId, epoch: this.pointer.epoch,
      generation: this.pointer.generation, contentHash: this.pointer.contentHash,
      acceptedHash: this.acceptedHash,
      durableHash: this.durableHash,
      dirtySequence: this.dirtySequence, durableSequence: this.durableSequence,
      status: this.frozen ? 'forbidden' : this.paused || this.fenced ? 'failed' : this.durableSequence >= this.dirtySequence ? 'durable' : 'pending' }
  }
  setFence(value: boolean): void { this.fenced = value; this.publishState() }
  deleted(): void { this.frozen = true; this.publishState(); this.closeConnections() }
  private publishState(): void { this.publish(this.state()) }
  private schedule(): void {
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => this.backgroundFlush(), this.options.debounceMs)
    this.deadline ??= setTimeout(() => this.backgroundFlush(), this.options.maxDelayMs)
  }
  private clearSchedule(): void {
    clearTimeout(this.debounce); clearTimeout(this.deadline)
    this.debounce = undefined; this.deadline = undefined
  }
  private backgroundFlush(): void { void this.flush().catch(() => {}) }
  async flush(target = this.dirtySequence): Promise<Pointer> {
    // Deleted rooms were already durably fenced. Framework unload/stop hooks may run afterwards.
    if (this.frozen && this.canUnload() && this.durableSequence >= target) return this.pointer
    if (this.frozen || this.disposed) throw new InternalFailure('COLLAB_EPOCH_CONFLICT', 409)
    while (this.durableSequence < target) {
      if (!this.persistPromise) {
        this.clearSchedule()
        this.persistPromise = this.persistOnce().finally(() => { this.persistPromise = undefined })
      }
      await this.persistPromise
    }
    return this.pointer
  }
  private async persistOnce(): Promise<void> {
    try {
      // Snapshot and sequence captured in one synchronous turn. Later edits remain in pending.
      this.attempt ??= { pointer: { ...this.pointer }, key: randomUUID(), bytes: encodeDocument(this.doc, this.identity), sequence: this.dirtySequence, fingerprint: this.acceptedHash }
      const attempt = this.attempt
      let saved: Pointer
      try { saved = await this.api.persist(attempt.pointer, attempt.key, attempt.bytes) }
      catch (error) {
        if (!(error instanceof InternalFailure) || error.code !== 'COLLAB_GENERATION_CONFLICT') throw error
        await this.rebase()
        this.attempt = undefined
        if (++this.conflicts >= 3) { this.conflicts = 0; throw error }
        // A conflict is not a successful save; caller retries against the new authoritative generation.
        return
      }
      if (saved.projectId !== this.pointer.projectId || saved.epoch !== this.pointer.epoch
        || saved.generation !== attempt.pointer.generation + 1 || saved.contentHash !== hash(attempt.bytes) || saved.size !== attempt.bytes.byteLength)
        throw new InternalFailure('COLLAB_PERSIST_RECEIPT_INVALID')
      this.pointer = saved; this.durableSequence = Math.max(this.durableSequence, attempt.sequence)
      this.durableHash = attempt.fingerprint
      this.pending = this.pending.filter(item => item.sequence > this.durableSequence)
      this.pendingBytes = this.pending.reduce((sum, item) => sum + item.update.byteLength, 0)
      this.attempt = undefined; this.failures = 0; this.conflicts = 0; this.paused = false
      clearTimeout(this.retry); this.retry = undefined
      this.publishState()
      if (this.pending.length) this.schedule()
    } catch (error) {
      this.paused = true; this.clearSchedule()
      if (error instanceof InternalFailure && ['COLLAB_EPOCH_CONFLICT', 'PROJECT_NOT_FOUND'].includes(error.code)) {
        this.frozen = true; this.closeConnections()
      } else if (!this.disposed) {
        clearTimeout(this.retry)
        this.retry = setTimeout(() => { this.retry = undefined; this.backgroundFlush() }, Math.min(30000, 500 * 2 ** Math.min(this.failures++, 6)))
      }
      this.publishState(); throw error
    }
  }
  private async rebase(): Promise<void> {
    this.paused = true
    const pointer = await this.api.describe(this.pointer.projectId)
    if (pointer.epoch !== this.pointer.epoch) throw new InternalFailure('COLLAB_EPOCH_CONFLICT', 409)
    const scratch = loadDocument(await this.api.load(pointer), this.identity)
    try {
      // Writes are paused while storage I/O occurs; every accepted update remains ordered and replayable.
      for (const item of this.pending) Y.applyUpdate(scratch, item.update)
      normalizeConflicts(scratch, this.identity)
      if (scratch.store.pendingStructs || scratch.store.pendingDs) throw new InternalFailure('COLLAB_UPDATE_DEPENDENCY', 400)
      const bytes = encodeDocument(scratch, this.identity)
      Y.applyUpdate(this.doc, bytes, 'gateway-rebase')
      validateDocument(this.doc, this.identity)
      this.acceptedHash = hash(Buffer.from(fingerprint(this.doc)))
      this.pointer = pointer
    } finally { scratch.destroy() }
  }
  canUnload(): boolean { return !this.pending.length && !this.attempt && !this.persistPromise }
  dispose(): void {
    if (!this.canUnload()) throw new InternalFailure('COLLAB_UNDURABLE_ROOM')
    this.disposed = true; this.clearSchedule(); clearTimeout(this.retry)
  }
}
