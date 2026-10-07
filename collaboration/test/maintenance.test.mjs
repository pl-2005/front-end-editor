import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { maintenanceClient } from '../scripts/maintenance-client.mjs'
import { signature } from '../dist/hmac.js'

const secret = 'test-only-maintenance-client-secret-at-least-32'
test('maintenance client refuses remote URLs and redacts untrusted errors', async t => {
  assert.throws(() => maintenanceClient('http://example.com', secret), /LOOPBACK/)
  assert.throws(() => maintenanceClient('http://127.0.0.1', 'short'), /SECRET/)
  const server = createServer((request, response) => response.writeHead(503).end(JSON.stringify({ code: 'sensitive jwt source password' }))).listen(0, '127.0.0.1')
  await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)))
  const call = maintenanceClient(`http://127.0.0.1:${server.address().port}`, secret)
  await assert.rejects(call('/internal/collaboration/metrics'), { message: 'MAINTENANCE_REQUEST_FAILED' })
})
async function fixture(t, { mismatch = false, committed = false } = {}) {
  const operationId = randomUUID(), pointer = { projectId: 1, epoch: 1, generation: 3,
    contentHash: 'a'.repeat(64), objectKey: `collab/projects/1/epochs/1/3-${'a'.repeat(64)}.yjs` }
  let posts = 0
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks), path = request.url
    assert.equal(request.headers['x-collab-signature'], signature(secret, request.method, path, 'maintenance',
      request.headers['x-collab-timestamp'], request.headers['x-collab-nonce'], body))
    let value
    if (path.endsWith('/after/0')) value = mismatch ? [1, 2] : [1]
    else if (path.includes('/after/')) value = []
    else if (path.endsWith('/status')) value = committed ? { state: 'COMMITTED', operationId } : { state: 'NONE' }
    else if (path.endsWith('/pointer')) value = pointer
    else if (path.endsWith('/recover')) { posts++; assert.equal(JSON.parse(body).operationId, operationId); value = { projectId: 1, epoch: 2, generation: 1 } }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
  }).listen(0, '127.0.0.1')
  await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)))
  const directory = fileURLToPath(new URL('../../.codex-build/step10-tool-' + randomUUID(), import.meta.url))
  mkdirSync(directory, { recursive: true })
  writeFileSync(directory + '/manifest.json', JSON.stringify({ schemaVersion: 1, projects: [{ ...pointer, active: true, recoveryOperationId: operationId }] }))
  const child = spawn(process.execPath, ['scripts/maintenance.mjs', 'recover-all', directory], {
    env: { ...process.env, COLLAB_MAINTENANCE_URL: `http://127.0.0.1:${server.address().port}`, COLLAB_MAINTENANCE_SECRET: secret },
    stdio: 'ignore', windowsHide: true })
  const [code] = await once(child, 'exit'); return { code, posts }
}
test('recover-all refuses an incomplete active-project manifest before any mutation', async t => {
  assert.deepEqual(await fixture(t, { mismatch: true }), { code: 1, posts: 0 })
})
test('recover-all validates current pointers and safely resumes committed operations', async t => {
  assert.deepEqual(await fixture(t), { code: 0, posts: 1 })
  assert.deepEqual(await fixture(t, { committed: true }), { code: 0, posts: 1 })
})
