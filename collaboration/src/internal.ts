import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { signature, equal, hash } from './hmac.js'
import { LIMITS } from './document.js'
import type { IncomingMessage } from 'node:http'

export class InternalFailure extends Error {
  constructor(public code: string, public status = 503) { super(code) }
}
export type Pointer = { projectId: number; epoch: number; generation: number; contentHash: string; size: number }
export type Identity = { userId: number; displayName: string; avatarColor: string; projectId: number; teamId: number; epoch: number; ticketId: string }
export type Authorization = { userId: number; projectId: number; epoch: number; authzVersion: number }
export interface StorageApi {
  describe(id: number): Promise<Pointer>
  load(pointer: Pointer): Promise<Uint8Array>
  persist(pointer: Pointer, key: string, bytes: Uint8Array): Promise<Pointer>
}
/** Durable receiver-local replay guard. It stores only nonce and expiry, never credentials or files. */
export class NonceStore {
  private db: DatabaseSync
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('CREATE TABLE IF NOT EXISTS collab_hmac_nonce(audience TEXT, nonce TEXT, expires_at INTEGER, PRIMARY KEY(audience,nonce))')
  }
  claim(audience: string, nonce: string): void {
    this.db.prepare('DELETE FROM collab_hmac_nonce WHERE expires_at < ?').run(Date.now())
    try { this.db.prepare('INSERT INTO collab_hmac_nonce VALUES (?,?,?)').run(audience, nonce, Date.now() + 61000) }
    catch { throw new InternalFailure('COLLAB_INTERNAL_UNAUTHORIZED', 401) }
  }
  close(): void { this.db.close() }
}
export function authenticateInternal(request: IncomingMessage, body: Uint8Array, secret: string, audience: string, nonces: NonceStore): void {
  const timestamp = request.headers['x-collab-timestamp'], nonce = request.headers['x-collab-nonce'], supplied = request.headers['x-collab-signature']
  if (Buffer.byteLength(secret) < 32 || typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp)
    || typeof nonce !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(nonce)
    || typeof supplied !== 'string' || Math.abs(Date.now() / 1000 - Number(timestamp)) > 30
    || !request.url || request.url.includes('?')
    || !equal(supplied, signature(secret, request.method ?? '', request.url, audience, timestamp, nonce, body)))
    throw new InternalFailure('COLLAB_INTERNAL_UNAUTHORIZED', 401)
  nonces.claim(audience, nonce)
}
export class SpringApi implements StorageApi {
  constructor(private baseUrl: string, private secret: string) {
    if (Buffer.byteLength(secret) < 32) throw new InternalFailure('COLLAB_INTERNAL_UNCONFIGURED')
  }
  private async request(path: string, method = 'GET', body: Uint8Array = new Uint8Array(), binary = false): Promise<any> {
    const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomUUID()
    const response = await fetch(this.baseUrl + path, { method, redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'X-Collab-Timestamp': timestamp, 'X-Collab-Nonce': nonce,
        'X-Collab-Signature': signature(this.secret, method, path, 'storage', timestamp, nonce, body),
        'Content-Type': binary ? 'application/octet-stream' : 'application/json' },
      ...(method === 'POST' ? { body: Buffer.from(body) } : {}) })
    const chunks: Uint8Array[] = []; let size = 0
    if (!response.body) throw new InternalFailure('COLLAB_INTERNAL_FAILED')
    for await (const chunk of response.body) {
      size += chunk.byteLength
      if (size > (binary && method === 'GET' && response.ok ? LIMITS.documentBytes : 16384)) throw new InternalFailure('COLLAB_RESPONSE_TOO_LARGE')
      chunks.push(chunk)
    }
    const bytes = Buffer.concat(chunks)
    if (!response.ok) {
      let code = 'COLLAB_INTERNAL_FAILED'
      try { code = JSON.parse(bytes.toString()).code ?? code } catch {}
      throw new InternalFailure(code, response.status)
    }
    return binary && method === 'GET' ? new Uint8Array(bytes) : JSON.parse(bytes.toString())
  }
  consume(ticket: string, projectId: number, epoch: number): Promise<{ identity: Identity; authorization: Authorization }> {
    return this.request('/internal/collaboration/tickets/consume', 'POST', Buffer.from(JSON.stringify({ ticket, projectId, epoch })))
  }
  revalidate(input: Authorization): Promise<Authorization> {
    return this.request('/internal/collaboration/connections/revalidate', 'POST', Buffer.from(JSON.stringify(input)))
  }
  async describe(id: number): Promise<Pointer> {
    const p = await this.request(`/internal/collaboration/projects/${id}/describe`)
    if (p.projectId !== id || !Number.isSafeInteger(p.epoch) || p.epoch < 1 || !Number.isSafeInteger(p.generation) || p.generation < 1
      || !/^[a-f0-9]{64}$/.test(p.contentHash) || p.size < 1 || p.size > LIMITS.documentBytes) throw new InternalFailure('COLLAB_STORAGE_CORRUPT')
    return p
  }
  async load(p: Pointer): Promise<Uint8Array> {
    const bytes = await this.request(`/internal/collaboration/projects/${p.projectId}/epochs/${p.epoch}/generations/${p.generation}/load`, 'GET', new Uint8Array(), true)
    if (bytes.byteLength !== p.size || hash(bytes) !== p.contentHash) throw new InternalFailure('COLLAB_STORAGE_CORRUPT')
    return bytes
  }
  persist(p: Pointer, key: string, bytes: Uint8Array): Promise<Pointer> {
    return this.request(`/internal/collaboration/projects/${p.projectId}/epochs/${p.epoch}/generations/${p.generation}/persist/${key}`, 'POST', bytes, true)
  }
}
