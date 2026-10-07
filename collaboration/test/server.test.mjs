import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomBytes, randomUUID } from 'node:crypto'
import { signature } from '../dist/hmac.js'
import { loadDocument } from '../dist/document.js'
test('initializer requires Spring HMAC, rejects replay/tampering and returns valid binary', async () => {
  const secret = randomBytes(32).toString('hex')
  const net = await import('node:net')
  const reservation = net.createServer().listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const env = { COLLAB_INITIALIZER_SECRET: secret, COLLAB_INITIALIZER_PORT: String(port) }
  for (const key of ['SystemRoot', 'PATH', 'Path', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key]
  const child = spawn(process.execPath, ['dist/server.js'], { env, stdio: 'pipe' })
  const url = `http://127.0.0.1:${port}/internal/initialize`
  try {
    let ready = false
    for (let i = 0; i < 100; i++) {
      try { await fetch(url); ready = true; break } catch { await new Promise(resolve => setTimeout(resolve, 20)) }
    }
    assert.ok(ready)
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401)
    const body = Buffer.from(JSON.stringify({ projectId: 1, epoch: 1, entry: '/index.html', files: [{ path: '/index.html', code: '<h1>Safe</h1>' }] }))
    const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomUUID()
    const headers = { 'X-Collab-Timestamp': timestamp, 'X-Collab-Nonce': nonce, 'X-Collab-Signature': signature(secret, 'POST', '/internal/initialize', 'initializer', timestamp, nonce, body) }
    const response = await fetch(url, { method: 'POST', headers, body })
    assert.equal(response.status, 200)
    const binary = new Uint8Array(await response.arrayBuffer())
    const doc = loadDocument(binary, { projectId: 1, epoch: 1 }); doc.destroy()
    assert.equal((await fetch(url, { method: 'POST', headers, body })).status, 401)
    assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, 'X-Collab-Nonce': randomUUID() }, body: Buffer.from('{}') })).status, 401)
    const rebuild = Buffer.from(JSON.stringify({ projectId: 1, epoch: 2, source: { projectId: 1, epoch: 1, bytes: Buffer.from(binary).toString('base64') } }))
    const nextNonce = randomUUID()
    const rebuilt = await fetch(url, { method: 'POST', body: rebuild, headers: { 'X-Collab-Timestamp': timestamp,
      'X-Collab-Nonce': nextNonce, 'X-Collab-Signature': signature(secret, 'POST', '/internal/initialize', 'initializer', timestamp, nextNonce, rebuild) } })
    assert.equal(rebuilt.status, 200); assert.equal(rebuilt.headers.get('x-collab-epoch'), '2')
    const bytes = new Uint8Array(await rebuilt.arrayBuffer())
    assert.throws(() => loadDocument(bytes, { projectId: 1, epoch: 1 }))
    const current = loadDocument(bytes, { projectId: 1, epoch: 2 })
    assert.equal(current.getMap('files').values().next().value.get('content').toString(), '<h1>Safe</h1>'); current.destroy()
  } finally {
    const exited = once(child, 'exit'); child.kill(); await exited
  }
})
