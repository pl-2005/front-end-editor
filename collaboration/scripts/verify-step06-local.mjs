import { createAuthFetch } from './auth-cookie-client.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync, openSync, closeSync, mkdirSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { createGateway } from '../dist/gateway.js'
import { SpringApi } from '../dist/internal.js'
import { loadDocument } from '../dist/document.js'

const root = fileURLToPath(new URL('../../', import.meta.url)), collab = fileURLToPath(new URL('../', import.meta.url))
const config = parseEnv(readFileSync(new URL('../../.env', import.meta.url), 'utf8'))
mkdirSync(root + '/.codex-build', { recursive: true })
const storageSecret = randomBytes(32).toString('hex'), gatewaySecret = randomBytes(32).toString('hex'), initializerSecret = randomBytes(32).toString('hex')
const base = 'http://127.0.0.1:18086', origin = 'http://localhost:5173'
const env = { ...process.env, ...config, AUTH_COOKIE_SECURE: 'false', AUTH_LOCAL_DEVELOPMENT: 'true', AUTH_ALLOWED_ORIGINS: origin, COLLAB_CREATION_ENABLED: 'true', COLLAB_TICKET_ENABLED: 'true', COLLAB_GATEWAY_ENABLED: 'true',
  COLLAB_GATEWAY_INTERNAL_URL: 'http://127.0.0.1:18092', COLLAB_INITIALIZER_URL: 'http://127.0.0.1:18093/internal/initialize',
  COLLAB_STORAGE_SECRET: storageSecret, COLLAB_GATEWAY_SECRET: gatewaySecret, COLLAB_INITIALIZER_SECRET: initializerSecret }
const encoderEnv = {}
for (const key of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP']) if (process.env[key]) encoderEnv[key] = process.env[key]
Object.assign(encoderEnv, { COLLAB_INITIALIZER_SECRET: initializerSecret, COLLAB_INITIALIZER_PORT: '18093', COLLAB_INITIALIZER_NONCE_PATH: root + '/.codex-build/step06-initializer-nonces.sqlite' })
const initializer = spawn(process.execPath, [collab + '/dist/server.js'], { cwd: collab, env: encoderEnv, stdio: 'ignore', windowsHide: true })
const log = openSync(root + '/.codex-build/step06-local-backend.log', 'w')
const backend = spawn('java', ['-jar', root + '/.codex-build/backend-check/backend-0.1.0-SNAPSHOT.jar', '--server.address=127.0.0.1', '--server.port=18086'],
  { cwd: root, env, stdio: ['ignore', log, log], windowsHide: true })
let gateway, token, client
const storage = new SpringApi(base, storageSecret)
const options = { enabled: true, origins: [origin], port: 18092, address: '127.0.0.1', springUrl: base, storageSecret, gatewaySecret,
  noncePath: root + '/.codex-build/step06-gateway-nonces.sqlite', maxRooms: 10, maxConnections: 20, maxRoomConnections: 10,
  maxMemoryBytes: 1024 * 1024 * 1024, maxMessagesPerSecond: 100, maxBytesPerSecond: 4 * 1024 * 1024 }
async function until(predicate, timeout = 10000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error('Local acceptance condition timeout')
}
const authFetch = createAuthFetch(origin)
async function api(path, method = 'GET', body, expected = 200) {
  const response = await authFetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) })
  const result = response.status === 204 ? undefined : await response.json()
  assert.equal(response.status, expected, `${method} ${path}: ${result?.code ?? 'unexpected status'}`)
  return result?.data
}
async function connect(projectId, ticket) {
  class OriginSocket extends WebSocket { constructor(url, protocols) { super(url, protocols, { origin }) } }
  const websocket = new HocuspocusProviderWebsocket({ url: 'ws://127.0.0.1:18092/collaboration', WebSocketPolyfill: OriginSocket, autoConnect: false, maxAttempts: 1 })
  const doc = new Y.Doc(), provider = new HocuspocusProvider({ websocketProvider: websocket, name: `project:${projectId}:epoch:1`, document: doc, token: ticket })
  client = { websocket, doc, provider }; provider.attach(); void websocket.connect()
  await until(() => provider.isSynced)
  return client
}
function destroyClient() {
  if (!client) return
  client.provider.destroy(); client.websocket.destroy(); client.doc.destroy(); client = undefined
}
async function stop(child) {
  if (!child || child.exitCode !== null) return
  const exited = once(child, 'exit'); child.kill(); await exited
}
try {
  await until(async () => {
    if (backend.exitCode !== null) throw new Error('Backend exited; inspect .codex-build/step06-local-backend.log')
    try { return (await fetch(base + '/api/health')).ok } catch { return false }
  }, 60000)
  gateway = createGateway(options); await gateway.server.listen()
  const username = 'step06_' + randomBytes(6).toString('hex'), password = randomBytes(20).toString('hex')
  await api('/api/auth/register', 'POST', { username, password }, 201)
  token = (await api('/api/auth/login', 'POST', { login: username, password })).accessToken
  const team = await api('/api/teams', 'POST', { name: 'Step06 acceptance' }, 201)
  const project = await api(`/api/teams/${team.id}/projects`, 'POST', { name: 'Step06 gateway', template: 'vanilla', entry: '/index.html' }, 201)
  const ticket = await api(`/api/projects/${project.id}/collab-ticket`, 'POST')
  const connected = await connect(project.id, ticket.ticket)
  await assert.rejects(storage.consume(ticket.ticket, project.id, 1))
  const entryId = connected.doc.getMap('meta').get('entryFileId'), content = connected.doc.getMap('files').get(entryId).get('content')
  const marker = '<!-- step06 auto persistence -->\n'; content.insert(0, marker)
  await until(async () => (await storage.describe(project.id)).generation >= 2)
  let pointer = await storage.describe(project.id), saved = loadDocument(await storage.load(pointer), { projectId: project.id, epoch: 1 })
  assert.ok(saved.getMap('files').get(entryId).get('content').toString().startsWith(marker)); saved.destroy()
  content.insert(0, '<!-- copy flush includes this edit -->\n')
  await until(() => gateway.rooms.get(`project:${project.id}:epoch:1`).dirtySequence >= 2)
  const copy = await api(`/api/teams/${team.id}/projects/${project.id}/copy`, 'POST', { name: 'Step06 flushed copy' }, 201)
  pointer = await storage.describe(copy.id); saved = loadDocument(await storage.load(pointer), { projectId: copy.id, epoch: 1 })
  assert.ok(saved.getMap('files').get(saved.getMap('meta').get('entryFileId')).get('content').toString().startsWith('<!-- copy flush includes this edit -->'))
  saved.destroy()
  content.insert(0, '<!-- last member leaves -->\n'); await until(() => gateway.rooms.get(`project:${project.id}:epoch:1`).dirtySequence >= 3)
  destroyClient(); await gateway.stop()
  gateway = createGateway(options); await gateway.server.listen()
  const next = await api(`/api/projects/${project.id}/collab-ticket`, 'POST'), recovered = await connect(project.id, next.ticket)
  assert.ok(recovered.doc.getMap('files').get(entryId).get('content').toString().startsWith('<!-- last member leaves -->'))
  console.log('PASS: single-use ticket, WebSocket sync, MySQL/MinIO automatic persistence, copy flush, leave flush and gateway restart recovery')
  console.log(`Acceptance project IDs: ${project.id}, ${copy.id}`)
} finally {
  destroyClient()
  if (gateway) await gateway.stop()
  await stop(backend); await stop(initializer); closeSync(log)
}
