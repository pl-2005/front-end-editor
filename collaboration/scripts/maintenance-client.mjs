import { randomUUID } from 'node:crypto'
import { signature } from '../dist/hmac.js'
import { LIMITS } from '../dist/document.js'

/** Loopback-only tooling. Never expose response bodies or credential-bearing network errors. */
export function maintenanceClient(baseUrl, secret) {
  const target = new URL(baseUrl)
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password || target.search || target.hash || target.pathname !== '/')
    throw new Error('MAINTENANCE_LOOPBACK_REQUIRED')
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) throw new Error('MAINTENANCE_SECRET_REQUIRED')
  return async (path, method = 'GET', value, binary = false) => {
    const body = value === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(value))
    const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomUUID()
    let response
    try {
      response = await fetch(target.origin + path, { method, redirect: 'error', signal: AbortSignal.timeout(60000),
        headers: { 'Content-Type': 'application/json', 'X-Collab-Timestamp': timestamp, 'X-Collab-Nonce': nonce,
          'X-Collab-Signature': signature(secret, method, path, 'maintenance', timestamp, nonce, body) },
        ...(method === 'POST' ? { body } : {}) })
      const chunks = []; let size = 0
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > (binary ? LIMITS.documentBytes : 256 * 1024)) throw new Error('MAINTENANCE_RESPONSE_LIMIT')
        chunks.push(chunk)
      }
      const bytes = Buffer.concat(chunks)
      if (!response.ok) {
        let code = 'MAINTENANCE_REQUEST_FAILED'
        try { const supplied = JSON.parse(bytes.toString()).code; if (typeof supplied === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(supplied)) code = supplied } catch {}
        throw new Error(code)
      }
      return binary ? bytes : JSON.parse(bytes.toString())
    } catch (failure) {
      const safe = /^[A-Z][A-Z0-9_]{0,79}$/.test(failure.message ?? '') ? failure.message : 'MAINTENANCE_REQUEST_FAILED'
      throw new Error(safe)
    }
  }
}
