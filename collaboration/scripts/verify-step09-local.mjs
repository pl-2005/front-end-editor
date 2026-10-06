import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync, openSync, closeSync, mkdirSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { randomBytes, createHash, createHmac } from 'node:crypto'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { createGateway } from '../dist/gateway.js'
import { SpringApi } from '../dist/internal.js'
import { loadDocument } from '../dist/document.js'

// Uses the root .env and installed local services. Credentials never leave process memory.
const root = fileURLToPath(new URL('../../', import.meta.url)), collab = fileURLToPath(new URL('../', import.meta.url))
const config = parseEnv(readFileSync(new URL('../../.env', import.meta.url), 'utf8'))
mkdirSync(root + '/.codex-build', { recursive: true })
const storageSecret = randomBytes(32).toString('hex'), gatewaySecret = randomBytes(32).toString('hex'), initializerSecret = randomBytes(32).toString('hex')
const base = 'http://127.0.0.1:18089', origin = 'http://localhost:5173'
const env = { ...process.env, ...config, COLLAB_CREATION_ENABLED: 'true', COLLAB_TICKET_ENABLED: 'true', COLLAB_GATEWAY_ENABLED: 'true',
  COLLAB_GATEWAY_INTERNAL_URL: 'http://127.0.0.1:18094', COLLAB_INITIALIZER_URL: 'http://127.0.0.1:18095/internal/initialize',
  COLLAB_STORAGE_SECRET: storageSecret, COLLAB_GATEWAY_SECRET: gatewaySecret, COLLAB_INITIALIZER_SECRET: initializerSecret }
const encoderEnv = {}
for (const key of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP']) if (process.env[key]) encoderEnv[key] = process.env[key]
Object.assign(encoderEnv, { COLLAB_INITIALIZER_SECRET: initializerSecret, COLLAB_INITIALIZER_PORT: '18095', COLLAB_INITIALIZER_NONCE_PATH: root + '/.codex-build/step09-initializer-nonces.sqlite' })
const initializer = spawn(process.execPath, [collab + '/dist/server.js'], { cwd: collab, env: encoderEnv, stdio: 'ignore', windowsHide: true })
const log = openSync(root + '/.codex-build/step09-local-backend.log', 'w')
const backend = spawn('java', ['-jar', root + '/.codex-build/step09-backend/backend-0.1.0-SNAPSHOT.jar', '--server.address=127.0.0.1', '--server.port=18089'],
  { cwd: root, env, stdio: ['ignore', log, log], windowsHide: true })
const storage = new SpringApi(base, storageSecret), clients = []
const options = { enabled: true, origins: [origin], port: 18094, address: '127.0.0.1', springUrl: base, storageSecret, gatewaySecret,
  noncePath: root + '/.codex-build/step09-gateway-nonces.sqlite', maxRooms: 10, maxConnections: 30, maxRoomConnections: 10,
  maxMemoryBytes: 1024 * 1024 * 1024, maxMessagesPerSecond: 100, maxBytesPerSecond: 4 * 1024 * 1024 }
let gateway
async function until(predicate, timeout = 10000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)) }
  throw new Error('Step09 local acceptance condition timeout')
}
async function api(user, path, method = 'GET', body, expected = 200, headers = {}) {
  const response = await fetch(base + path, { method, headers: { ...(user ? { Authorization: `Bearer ${user.token}` } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) })
  const result = response.status === 204 ? undefined : await response.json()
  assert.equal(response.status, expected, `${method} ${path}: ${result?.code ?? 'unexpected status'}`)
  return result?.data
}
async function account(label) {
  const name = 's09_' + label + '_' + randomBytes(5).toString('hex'), password = randomBytes(20).toString('hex')
  await api(null, '/api/auth/register', 'POST', { username: name, password }, 201)
  const login = await api(null, '/api/auth/login', 'POST', { login: name, password })
  return { id: login.user.id, name, password, token: login.accessToken }
}
async function login(user) { user.token = (await api(null, '/api/auth/login', 'POST', { login: user.name, password: user.password })).accessToken }
async function join(owner, member, teamId) {
  const invitation = await api(owner, `/api/teams/${teamId}/invitations`, 'POST', { userId: member.id }, 201)
  await api(member, `/api/teams/invitations/${invitation.id}/accept`, 'POST')
}
async function connect(user, projectId) {
  const ticket = await api(user, `/api/projects/${projectId}/collab-ticket`, 'POST')
  class OriginSocket extends WebSocket { constructor(url, protocols) { super(url, protocols, { origin }) } }
  const websocket = new HocuspocusProviderWebsocket({ url: 'ws://127.0.0.1:18094/collaboration', WebSocketPolyfill: OriginSocket, autoConnect: false, maxAttempts: 1 })
  const doc = new Y.Doc(), provider = new HocuspocusProvider({ websocketProvider: websocket, name: `project:${projectId}:epoch:${ticket.epoch}`, document: doc, token: ticket.ticket })
  const client = { websocket, doc, provider, projectId, closed: false }
  provider.on('close', ({ event }) => {
    if (event.code === 4403 || ['COLLAB_USER_REVOKED', 'COLLAB_PROJECT_DELETED', 'COLLAB_AUTHORIZATION_EXPIRED'].includes(event.reason)) {
      client.closed = true; client.closeReason = event.reason
    }
  })
  clients.push(client); provider.attach(); void websocket.connect(); await until(() => provider.isSynced)
  return client
}
function edit(client, marker) { client.doc.getMap('files').get(client.doc.getMap('meta').get('entryFileId')).get('content').insert(0, marker) }
async function retainedObject(pointer) {
  // Acceptance-only read using root .env; the application gateway still never receives MinIO credentials.
  const url = new URL(config.MINIO_ENDPOINT ?? 'http://localhost:9000')
  url.pathname = '/' + [config.MINIO_BUCKET ?? 'web-editor', ...`collab/projects/${pointer.projectId}/epochs/${pointer.epoch}/${pointer.generation}-${pointer.contentHash}.yjs`.split('/')].map(encodeURIComponent).join('/')
  const date = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z', day = date.slice(0, 8)
  const sha = value => createHash('sha256').update(value).digest('hex'), empty = sha('')
  const hmac = (key, value) => createHmac('sha256', key).update(value).digest()
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonical = ['GET', url.pathname, '', `host:${url.host}\nx-amz-content-sha256:${empty}\nx-amz-date:${date}\n`, signedHeaders, empty].join('\n')
  const scope = `${day}/us-east-1/s3/aws4_request`
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + config.MINIO_SECRET_KEY, day), 'us-east-1'), 's3'), 'aws4_request')
  const signature = hmac(signingKey, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${sha(canonical)}`).toString('hex')
  const response = await fetch(url, { headers: { 'X-Amz-Date': date, 'X-Amz-Content-Sha256': empty,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.MINIO_ACCESS_KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` }, signal: AbortSignal.timeout(10000) })
  assert.equal(response.status, 200, 'retained MinIO object must remain readable to the acceptance verifier')
  const bytes = new Uint8Array(await response.arrayBuffer())
  assert.equal(bytes.length, pointer.size); assert.equal(sha(bytes), pointer.contentHash)
  return bytes
}
function destroyClients() { for (const c of clients.splice(0)) { c.provider.destroy(); c.websocket.destroy(); c.doc.destroy() } }
async function stop(child) { if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited } }
try {
  await until(async () => {
    if (backend.exitCode !== null) throw new Error('Backend exited; inspect .codex-build/step09-local-backend.log')
    try { return (await fetch(base + '/api/health')).ok } catch { return false }
  }, 60000)
  gateway = createGateway(options); await gateway.server.listen()
  const owner = await account('owner'), member = await account('member')
  const team = await api(owner, '/api/teams', 'POST', { name: 'Step09 acceptance' }, 201)
  await join(owner, member, team.id)
  const project = await api(owner, `/api/teams/${team.id}/projects`, 'POST', { name: 'Step09 delete', template: 'vanilla', entry: '/index.html' }, 201)
  const a = await connect(owner, project.id), b = await connect(member, project.id)
  const old = await api(owner, `/api/projects/${project.id}/collab-ticket`, 'POST')
  edit(a, '<!-- durable before delete -->\n')
  const room = gateway.rooms.get(`project:${project.id}:epoch:1`)
  await until(() => room.dirtySequence > 0)
  const key = `"project-${project.id}-${project.stateVersion}"`
  // MEMBER can delete with the same rights as OWNER, including an idempotent retry.
  await api(member, `/api/teams/${team.id}/projects/${project.id}`, 'DELETE', undefined, 204, { 'If-Match': key })
  assert.equal(room.durableSequence, room.dirtySequence); assert.ok(room.pointer.generation >= 2)
  await assert.rejects(storage.load(room.pointer)); await assert.rejects(storage.describe(project.id))
  const retained = loadDocument(await retainedObject(room.pointer), { projectId: project.id, epoch: 1 })
  assert.ok(retained.getMap('files').get(retained.getMap('meta').get('entryFileId')).get('content').toString().startsWith('<!-- durable before delete -->'))
  retained.destroy()
  await until(() => a.closed && b.closed)
  await assert.rejects(storage.consume(old.ticket, project.id, 1))
  await api(owner, `/api/projects/${project.id}/collab-ticket`, 'POST', undefined, 403)
  await api(member, `/api/teams/${team.id}/projects/${project.id}`, 'DELETE', undefined, 204, { 'If-Match': key })
  const empty = await api(owner, `/api/teams/${team.id}/projects`, 'POST', { name: 'Step09 empty delete', template: 'vanilla', entry: '/index.html' }, 201)
  await api(owner, `/api/teams/${team.id}/projects/${empty.id}`, 'DELETE', undefined, 204, { 'If-Match': `"project-${empty.id}-${empty.stateVersion}"` })
  const live = await api(owner, `/api/teams/${team.id}/projects`, 'POST', { name: 'Step09 revoke', template: 'vanilla', entry: '/index.html' }, 201)
  let valid = await connect(owner, live.id), revoked = await connect(member, live.id)
  const stale = await api(member, `/api/projects/${live.id}/collab-ticket`, 'POST')
  await api(owner, `/api/teams/${team.id}/members/${member.id}`, 'DELETE', undefined, 204)
  await until(() => revoked.closed); assert.equal(valid.provider.isSynced, true)
  assert.equal(revoked.closeReason, 'COLLAB_USER_REVOKED', 'member removal must use the active Outbox event')
  await assert.rejects(storage.consume(stale.ticket, live.id, 1))
  await api(member, `/api/projects/${live.id}/collab-ticket`, 'POST', undefined, 403)
  await join(owner, member, team.id); revoked = await connect(member, live.id)
  await api(member, `/api/teams/${team.id}/members/me`, 'DELETE', undefined, 204)
  await until(() => revoked.closed); assert.equal(valid.provider.isSynced, true)
  assert.equal(revoked.closeReason, 'COLLAB_USER_REVOKED', 'team exit must use the active Outbox event')
  await join(owner, member, team.id); revoked = await connect(member, live.id)
  const newPassword = randomBytes(20).toString('hex')
  await api(member, '/api/auth/password', 'PUT', { currentPassword: member.password, newPassword }, 204)
  member.password = newPassword; await until(() => revoked.closed); assert.equal(valid.provider.isSynced, true)
  assert.equal(revoked.closeReason, 'COLLAB_USER_REVOKED', 'password change must use the active Outbox event')
  await login(member); revoked = await connect(member, live.id)
  await api(member, '/api/auth/logout', 'POST', undefined, 204)
  await until(() => revoked.closed); assert.equal(valid.provider.isSynced, true)
  assert.equal(revoked.closeReason, 'COLLAB_USER_REVOKED', 'logout must use the active Outbox event')
  edit(valid, '<!-- live after all revocations -->\n')
  await until(async () => (await storage.describe(live.id)).generation >= 2)
  destroyClients(); await gateway.stop(); gateway = createGateway(options); await gateway.server.listen()
  valid = await connect(owner, live.id)
  assert.ok(valid.doc.getMap('files').get(valid.doc.getMap('meta').get('entryFileId')).get('content').toString().startsWith('<!-- live after all revocations -->'))
  await assert.rejects(storage.describe(project.id))
  console.log('PASS: durable delete, empty-room fence, idempotency, old tickets, all four revocations, unaffected member writes and restart recovery')
  console.log(`Acceptance project IDs: ${project.id}, ${empty.id}, ${live.id}`)
} finally {
  destroyClients()
  try { if (gateway) await gateway.stop() } finally { await stop(backend); await stop(initializer); closeSync(log) }
}
