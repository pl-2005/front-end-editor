import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import { createGateway } from '../dist/gateway.js'
import { createDocument, encodeDocument, loadDocument } from '../dist/document.js'
import { hash, signature } from '../dist/hmac.js'

const storageSecret = 'test-storage-secret-at-least-32-bytes', gatewaySecret = 'test-gateway-secret-at-least-32-bytes'
const origin = 'http://localhost:5173'
async function until(predicate, timeout = 3000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)) }
  throw new Error('Condition timeout')
}
async function setup(t) {
  const initial = createDocument({ projectId: 1, epoch: 1 }, '/index.html', [{ path: '/index.html', code: 'initial' }])
  let bytes = encodeDocument(initial, { projectId: 1, epoch: 1 }); initial.destroy()
  let pointer = { projectId: 1, epoch: 1, generation: 1, size: bytes.length, contentHash: hash(bytes) }, consumes = 0, allow = true, storageFail = false
  const tickets = new Map(), receipts = new Map(), operations = new Map()
  const spring = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks), path = request.url
    const timestamp = request.headers['x-collab-timestamp'], nonce = request.headers['x-collab-nonce']
    assert.equal(request.headers['x-collab-signature'], signature(storageSecret, request.method, path, 'storage', timestamp, nonce, body))
    const json = (value, code = 200) => response.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
    if (path === '/internal/collaboration/tickets/consume') {
      consumes++; const input = JSON.parse(body)
      const credential = tickets.get(input.ticket)
      if (!tickets.delete(input.ticket) || input.projectId !== 1 || input.epoch !== 1 || !allow) return json({ code: 'COLLAB_TICKET_INVALID' }, 401)
      return json({ identity: { userId: credential.userId, displayName: 'Verified', avatarColor: '#123456', projectId: 1, teamId: 2, epoch: 1, ticketId: randomUUID() },
        authorization: { userId: credential.userId, projectId: 1, epoch: 1, authzVersion: credential.version } })
    }
    if (path === '/internal/collaboration/connections/revalidate') return json(allow ? JSON.parse(body) : { code: 'COLLAB_FORBIDDEN' }, allow ? 200 : 403)
    if (path.includes('/operations/')) return json(operations.get(path.split('/').at(-1)) ?? { code: 'COLLAB_OPERATION_NOT_FOUND' }, operations.has(path.split('/').at(-1)) ? 200 : 404)
    if (path.endsWith('/control')) {
      const op = [...operations.values()].find(op => op.state === 'PREPARED')
      return json({ projectId: 1, epoch: pointer.epoch, state: op ? 'FENCED' : 'ACTIVE', operationId: op?.id ?? null })
    }
    if (path.endsWith('/describe')) return json(pointer)
    if (path.endsWith('/load')) { response.writeHead(200).end(bytes); return }
    const match = /\/generations\/(\d+)\/persist\/(.+)$/.exec(path)
    if (match) {
      if (storageFail) return json({ code: 'COLLAB_STORAGE_UNAVAILABLE' }, 503)
      if (receipts.has(match[2])) return json(receipts.get(match[2]))
      if (Number(match[1]) !== pointer.generation) return json({ code: 'COLLAB_GENERATION_CONFLICT' }, 409)
      bytes = new Uint8Array(body); pointer = { ...pointer, generation: pointer.generation + 1, size: bytes.length, contentHash: hash(bytes) }
      receipts.set(match[2], pointer); return json(pointer)
    }
    response.writeHead(404).end()
  }).listen(0, '127.0.0.1')
  await once(spring, 'listening')
  const gateway = createGateway({ enabled: true, origins: [origin], port: 0, address: '127.0.0.1',
    springUrl: `http://127.0.0.1:${spring.address().port}`, storageSecret, gatewaySecret, noncePath: ':memory:',
    maxRooms: 5, maxConnections: 20, maxRoomConnections: 10, maxMemoryBytes: 1024 * 1024 * 1024,
    maxMessagesPerSecond: 100, maxBytesPerSecond: 4 * 1024 * 1024 })
  await gateway.server.listen()
  const clients = [], url = `ws://127.0.0.1:${gateway.server.address.port}/collaboration`
  t.after(async () => {
    for (const { provider, websocket, doc } of clients) { provider.destroy(); websocket.destroy(); doc.destroy() }
    await gateway.stop(); await new Promise(resolve => spring.close(resolve))
  })
  return { gateway, url, get consumes() { return consumes }, get bytes() { return bytes }, get pointer() { return pointer },
    revoke() { allow = false },
    operations,
    failStorage(value) { storageFail = value },
    async connect(ticket = randomUUID(), userId = 10, version = 1) {
      tickets.set(ticket, { userId, version })
      class OriginSocket extends WebSocket { constructor(url, protocols) { super(url, protocols, { origin }) } }
      const doc = new Y.Doc(), websocket = new HocuspocusProviderWebsocket({ url, WebSocketPolyfill: OriginSocket, autoConnect: false, maxAttempts: 1 })
      const provider = new HocuspocusProvider({ name: 'project:1:epoch:1', document: doc, websocketProvider: websocket, token: ticket })
      provider.attach()
      const client = { provider, websocket, doc }; clients.push(client)
      void websocket.connect(); await until(() => provider.isSynced)
      return client
    },
    async flush(headers) {
      const path = '/internal/collaboration/projects/1/flush', timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomUUID()
      return fetch(`http://127.0.0.1:${gateway.server.address.port}` + path, { method: 'POST', headers: headers ?? {
        'X-Collab-Timestamp': timestamp, 'X-Collab-Nonce': nonce,
        'X-Collab-Signature': signature(gatewaySecret, 'POST', path, 'gateway', timestamp, nonce, new Uint8Array()) } })
    },
    async control(path, value) {
      const body = Buffer.from(JSON.stringify(value)), timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomUUID()
      return fetch(`http://127.0.0.1:${gateway.server.address.port}` + path, { method: 'POST', body, headers: {
        'Content-Type': 'application/json', 'X-Collab-Timestamp': timestamp, 'X-Collab-Nonce': nonce,
        'X-Collab-Signature': signature(gatewaySecret, 'POST', path, 'gateway', timestamp, nonce, body) } })
    },
  }
}
test('Origin is rejected before consuming a ticket; valid provider syncs and reverse flush authenticates', async t => {
  const f = await setup(t)
  const denied = new WebSocket(f.url, { origin: 'http://attacker.example' })
  denied.on('error', () => {})
  const rejected = await new Promise(resolve => denied.once('unexpected-response', (_, response) => { resolve(response.statusCode); denied.terminate() }))
  assert.equal(rejected, 403); assert.equal(f.consumes, 0)
  const client = await f.connect()
  assert.equal(client.doc.getMap('files').size, 1)
  client.doc.getMap('files').values().next().value.get('content').insert(0, 'edited')
  await until(() => f.gateway.rooms.get('project:1:epoch:1').dirtySequence > 0)
  assert.equal((await f.flush({})).status, 401)
  const response = await f.flush(); assert.equal(response.status, 200)
  const durable = await response.json(); assert.equal(durable.generation, 2)
  const doc = loadDocument(f.bytes, { projectId: 1, epoch: 1 })
  assert.ok(doc.getMap('files').values().next().value.get('content').toString().startsWith('edited')); doc.destroy()
})
test('multiple clients share one room; forged identity is overwritten; malicious update never reaches peers', async t => {
  const f = await setup(t), a = await f.connect(), b = await f.connect()
  assert.equal(f.gateway.rooms.size, 1)
  const entryId = a.doc.getMap('meta').get('entryFileId')
  a.provider.awareness.setLocalState({ user: { id: 999, name: 'Impersonation' }, activeFileId: entryId })
  await until(() => b.provider.awareness.getStates().get(a.doc.clientID)?.user?.id === 10)
  const ownPresence = b.provider.awareness.getStates().get(a.doc.clientID)
  assert.ok(ownPresence.user.connectionId)
  const text = a.doc.getMap('files').get(entryId).get('content')
  a.provider.awareness.setLocalStateField('selection', { anchor: Y.createRelativePositionFromTypeIndex(text, 0), head: Y.createRelativePositionFromTypeIndex(text, 3) })
  await until(() => b.provider.awareness.getStates().get(a.doc.clientID)?.selection?.head?.item)
  b.provider.awareness.setLocalState({ activeFileId: entryId })
  await until(() => f.gateway.rooms.get('project:1:epoch:1').doc.awareness.getStates().has(b.doc.clientID))
  assert.notEqual(ownPresence.user.connectionId, f.gateway.rooms.get('project:1:epoch:1').doc.awareness.getStates().get(b.doc.clientID).user.connectionId)
  const payload = encoding.createEncoder()
  encoding.writeVarUint(payload, 1); encoding.writeVarUint(payload, b.doc.clientID); encoding.writeVarUint(payload, 999999)
  encoding.writeVarString(payload, JSON.stringify({ user: { id: 999, name: 'Forged peer' } }))
  const frame = encoding.createEncoder()
  encoding.writeVarString(frame, 'project:1:epoch:1'); encoding.writeVarUint(frame, 1)
  encoding.writeVarUint8Array(frame, encoding.toUint8Array(payload))
  a.websocket.webSocket.send(encoding.toUint8Array(frame))
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(f.gateway.rooms.get('project:1:epoch:1').doc.awareness.getStates().get(b.doc.clientID).user.id, 10)
  a.doc.getMap('files').get(entryId).get('content').insert(0, 'accepted')
  await until(() => b.doc.getMap('files').get(entryId).get('content').toString().startsWith('accepted'))
  a.doc.getMap('meta').set('epoch', 999)
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(b.doc.getMap('meta').get('epoch'), 1)
  assert.equal(f.gateway.rooms.get('project:1:epoch:1').doc.getMap('meta').get('epoch'), 1)
})
test('authorization renewal failure closes connection within the five-second lease', async t => {
  const f = await setup(t), client = await f.connect()
  const room = f.gateway.rooms.get('project:1:epoch:1'), accepted = room.dirtySequence
  f.revoke()
  await until(() => room.doc.getConnectionsCount() === 0, 5500)
  client.doc.getMap('files').values().next().value.get('content').insert(0, 'forbidden')
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(room.dirtySequence, accepted)
})

test('delete fence flushes accepted updates, blocks further input and retries with the same token', async t => {
  const f = await setup(t), client = await f.connect(), operationId = randomUUID()
  const room = f.gateway.rooms.get('project:1:epoch:1')
  client.doc.getMap('files').values().next().value.get('content').insert(0, 'before-delete')
  await until(() => room.dirtySequence === 1)
  f.operations.set(operationId, { id: operationId, projectId: 1, expectedEpoch: 1, state: 'PREPARED' })
  const path = '/internal/collaboration/projects/1/fence'
  const first = await f.control(path, { operationId }); assert.equal(first.status, 200)
  const ack = await first.json(); assert.equal(ack.generation, 2); assert.equal(ack.durableSequence, 1)
  assert.equal(room.fenced, true); assert.equal(room.pending.length, 0)
  assert.throws(() => room.accept(new Uint8Array([0, 0])), /COLLAB_ROOM_READ_ONLY/)
  const retry = await f.control(path, { operationId }); assert.equal((await retry.json()).fenceToken, ack.fenceToken)
  f.operations.get(operationId).state = 'COMMITTED'
  const event = { id: randomUUID(), aggregateId: 'project:1', aggregateSequence: 1, eventType: 'PROJECT_DELETED',
    projectId: 1, epoch: 2, operationId }
  assert.equal((await f.control('/internal/collaboration/control', event)).status, 200)
  await until(() => room.doc.getConnectionsCount() === 0)
  assert.equal(room.frozen, true)
  assert.equal((await f.control('/internal/collaboration/control', event)).status, 200)
})

test('empty-room fence verifies the current pointer; only a database-confirmed abort releases it', async t => {
  const f = await setup(t), operationId = randomUUID()
  f.operations.set(operationId, { id: operationId, projectId: 1, expectedEpoch: 1, state: 'PREPARED' })
  const result = await f.control('/internal/collaboration/projects/1/fence', { operationId })
  assert.equal(result.status, 200); assert.equal((await result.json()).generation, 1)
  const event = { id: randomUUID(), aggregateId: 'project:1', aggregateSequence: 1, eventType: 'OPERATION_ABORTED', projectId: 1, epoch: 1, operationId }
  assert.equal((await f.control('/internal/collaboration/control', event)).status, 503)
  f.operations.get(operationId).state = 'ABORTED'
  assert.equal((await f.control('/internal/collaboration/control', event)).status, 200)
  const client = await f.connect(); assert.equal(client.provider.isSynced, true)
})

test('failed durable-close retains pending work and its fence until storage recovers', async t => {
  const f = await setup(t), client = await f.connect(), operationId = randomUUID()
  const room = f.gateway.rooms.get('project:1:epoch:1')
  client.doc.getMap('files').values().next().value.get('content').insert(0, 'must-survive')
  await until(() => room.dirtySequence > 0)
  f.operations.set(operationId, { id: operationId, projectId: 1, expectedEpoch: 1, state: 'PREPARED' })
  f.failStorage(true)
  assert.equal((await f.control('/internal/collaboration/projects/1/fence', { operationId })).status, 503)
  assert.equal(room.fenced, true); assert.equal(room.pending.length, 1); assert.equal(room.durableSequence, 0)
  assert.throws(() => room.accept(new Uint8Array([0, 0])), /COLLAB_ROOM_READ_ONLY/)
  f.failStorage(false)
  assert.equal((await f.control('/internal/collaboration/projects/1/fence', { operationId })).status, 200)
  assert.equal(room.pending.length, 0); assert.equal(room.durableSequence, room.dirtySequence)
})

test('outbox revokes only stale target-user connections; duplicate and reordered events preserve current sessions', async t => {
  const f = await setup(t), a = await f.connect(), b = await f.connect(randomUUID(), 11)
  const room = f.gateway.rooms.get('project:1:epoch:1')
  const event = { id: randomUUID(), aggregateId: 'user:10', aggregateSequence: 2, eventType: 'USER_REVOKED', userId: 10, authzVersion: 2 }
  assert.equal((await f.control('/internal/collaboration/control', event)).status, 200)
  await until(() => room.doc.getConnectionsCount() === 1)
  assert.equal(b.provider.isSynced, true)
  const current = await f.connect(randomUUID(), 10, 3)
  assert.equal((await f.control('/internal/collaboration/control', event)).status, 200)
  assert.equal((await f.control('/internal/collaboration/control', { ...event, id: randomUUID(), aggregateSequence: 1, authzVersion: 1 })).status, 200)
  assert.equal(room.doc.getConnectionsCount(), 2)
  assert.equal(current.provider.isSynced, true); assert.equal(a.provider.isSynced, false)
  b.doc.getMap('files').values().next().value.get('content').insert(0, 'still-valid')
  await until(() => room.dirtySequence > 0)
})
