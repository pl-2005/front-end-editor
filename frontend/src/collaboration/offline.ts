import * as Y from 'yjs'
import { clearDocument, fetchUpdates, type IndexeddbPersistence } from 'y-indexeddb'
import { fingerprint, LIMITS, readDocument, type Identity } from './document'

export const OFFLINE_LIMIT = 1536 * 1024
export const CACHE_LIMIT = LIMITS.documentBytes + OFFLINE_LIMIT
export type LocalStatus = 'loading' | 'saving' | 'saved' | 'full' | 'failed'
export const cacheName = (userId: number, identity: Identity) => `web-editor:${userId}:${identity.projectId}:${identity.epoch}`
const active = new Set<OfflineLog>()
const commit = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error('本地日志保存失败，请恢复网络后导出'))
})
const request = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  req.onsuccess = () => resolve(req.result); req.onerror = () => reject(new Error('本地日志读取失败'))
})
async function open(name: string) {
  const req = indexedDB.open(name)
  req.onupgradeneeded = () => {
    req.result.createObjectStore('updates', { autoIncrement: true }); req.result.createObjectStore('custom')
  }
  return request(req)
}

/** Uses the pinned y-indexeddb update schema/reader, with atomic, bounded writes.
 * Its default fire-and-forget writer cannot report quota/transaction failures.
 * Each transaction merges ALL stored updates before compacting, preserving peers
 * writing the same user/project/epoch database in another tab. */
export class OfflineLog {
  state: LocalStatus = 'loading'
  recoveryIds: string[] = []
  private db?: IDBDatabase
  private stopped = false
  private chain: Promise<void> = Promise.resolve()
  private buffered = 0
  private failed = false
  constructor(readonly name: string, readonly identity: Identity, private status: (value: LocalStatus) => void, private revoked: () => void = () => {}) { active.add(this) }
  private report(value: LocalStatus) { this.state = value; this.status(value) }
  async load(doc: Y.Doc) {
    this.db = await open(this.name)
    if (this.stopped) { this.db.close(); return 0 }
    this.db.onversionchange = () => { this.stopped = true; this.db?.close(); this.revoked() }
    const tx = this.db.transaction(['updates'], 'readonly')
    const updates = await request(tx.objectStore('updates').getAll()) as Uint8Array[]
    if (updates.reduce((n, u) => n + u.byteLength, 0) > CACHE_LIMIT) throw new Error('本地日志超出容量，已隔离')
    const scratch = new Y.Doc({ gc: false })
    try {
      // fetchUpdates only reads these five fields (y-indexeddb 9.0.12).
      const reader = { db: this.db, doc: scratch, _dbref: 0, _dbsize: 0, _destroyed: false } as IndexeddbPersistence
      await fetchUpdates(reader)
      if (scratch.getMap('meta').size) readDocument(scratch, this.identity)
      if (!this.stopped) Y.applyUpdate(doc, Y.encodeStateAsUpdate(scratch), this)
    } finally { scratch.destroy() }
    const custom = this.db.transaction('custom', 'readonly').objectStore('custom')
    const [pending, recoveryIds] = await Promise.all([request(custom.get('pendingBytes')), request(custom.get('recoveryIds'))])
    if (Array.isArray(recoveryIds) && recoveryIds.length <= LIMITS.files && recoveryIds.every(id => typeof id === 'string' && id.length <= 100)) this.recoveryIds = recoveryIds
    if (!this.stopped) this.report('saved')
    return typeof pending === 'number' ? pending : 0
  }
  save(update: Uint8Array, local = false) {
    if (this.stopped || this.failed || !this.db) return
    this.buffered += update.byteLength
    if (this.buffered > CACHE_LIMIT) { this.failed = true; this.report('failed'); return }
    this.report('saving')
    this.chain = this.chain.then(async () => {
      if (this.stopped || !this.db) return
      const tx = this.db.transaction(['updates', 'custom'], 'readwrite'), done = commit(tx)
      const store = tx.objectStore('updates'), all = store.getAll()
      // Stay in the IDB callback: the transaction must remain active.
      all.onsuccess = () => {
        try {
          const merged = Y.mergeUpdates([...all.result, update])
          if (merged.byteLength > CACHE_LIMIT) { tx.abort(); return }
          store.clear(); store.add(merged)
        } catch { tx.abort(); return }
        if (local) {
          const custom = tx.objectStore('custom'), pending = custom.get('pendingBytes')
          pending.onsuccess = () => {
            const bytes = (Number(pending.result) || 0) + update.byteLength
            if (bytes > OFFLINE_LIMIT) tx.abort(); else custom.put(bytes, 'pendingBytes')
          }
        }
      }
      await done
    }).then(() => {
      this.buffered -= update.byteLength
      if (!this.stopped && this.buffered === 0 && !this.failed) this.report('saved')
    }).catch(() => { this.failed = true; if (!this.stopped) this.report('failed') })
  }
  acknowledge(expected: string) {
    this.chain = this.chain.then(async () => {
      if (this.stopped || !this.db) return
      const tx = this.db.transaction(['updates', 'custom'], 'readwrite'), done = commit(tx)
      const all = tx.objectStore('updates').getAll()
      all.onsuccess = () => {
        const scratch = new Y.Doc()
        try {
          for (const update of all.result) Y.applyUpdate(scratch, update)
          if (fingerprint(scratch) === expected) {
            tx.objectStore('custom').put(0, 'pendingBytes')
            const store = tx.objectStore('updates'); store.clear(); store.add(Y.encodeStateAsUpdate(scratch))
          }
        } catch { tx.abort() } finally { scratch.destroy() }
      }
      await done
    }).catch(() => { this.failed = true; if (!this.stopped) this.report('failed') })
  }
  rememberRecoveries(ids: string[]) {
    this.recoveryIds = ids
    this.chain = this.chain.then(async () => {
      if (this.stopped || !this.db) return
      const tx = this.db.transaction('custom', 'readwrite'), done = commit(tx)
      tx.objectStore('custom').put(ids, 'recoveryIds'); await done
    }).catch(() => { this.failed = true; if (!this.stopped) this.report('failed') })
  }
  async close(clear = false) {
    // Normal navigation waits for writes; revocation cancels queued writes.
    if (clear && !this.stopped) { this.stopped = true; this.revoked() }
    await this.chain
    this.stopped = true; this.db?.close(); active.delete(this)
    if (clear) await clearDocument(this.name)
  }
  settled() { return this.chain }
}

/** Evict inaccessible old epochs before opening the authorized current epoch. */
export async function clearOtherEpochs(userId: number, identity: Identity) {
  if (!indexedDB.databases) return
  const prefix = `web-editor:${userId}:${identity.projectId}:`, current = cacheName(userId, identity)
  await Promise.all((await indexedDB.databases()).filter(db => db.name?.startsWith(prefix) && db.name !== current).map(db => clearDocument(db.name!)))
}
export async function purgeUserCaches(userId: number) {
  const prefix = `web-editor:${userId}:`
  await Promise.all([...active].filter(log => log.name.startsWith(prefix)).map(log => log.close(true)))
  if (indexedDB.databases) await Promise.all((await indexedDB.databases()).filter(db => db.name?.startsWith(prefix)).map(db => clearDocument(db.name!)))
}
export async function purgeProjectCaches(userId: number, projectId: number) {
  const prefix = `web-editor:${userId}:${projectId}:`
  await Promise.all([...active].filter(log => log.name.startsWith(prefix)).map(log => log.close(true)))
  if (indexedDB.databases) await Promise.all((await indexedDB.databases()).filter(db => db.name?.startsWith(prefix)).map(db => clearDocument(db.name!)))
}
export async function cachedProjectIds(userId: number) {
  const prefix = `web-editor:${userId}:`
  const names = indexedDB.databases ? (await indexedDB.databases()).map(db => db.name ?? '') : [...active].map(log => log.name)
  return [...new Set(names.filter(name => name.startsWith(prefix)).map(name => Number(name.slice(prefix.length).split(':')[0])))].filter(Number.isSafeInteger)
}
