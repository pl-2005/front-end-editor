import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, openSync, closeSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomBytes, randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { createGateway } from '../dist/gateway.js'
import { SpringApi } from '../dist/internal.js'
import { loadDocument } from '../dist/document.js'
import { readDirectories } from '../dist/directories.js'

// Isolated application ports; shared local MySQL/MinIO/Redis come only from root .env.
const root = fileURLToPath(new URL('../../', import.meta.url))
const config = parseEnv(readFileSync(root + '.env', 'utf8'))
const base = 'http://127.0.0.1:18598', origin = 'http://127.0.0.1:15575'
const storageSecret = randomBytes(32).toString('hex'), gatewaySecret = randomBytes(32).toString('hex'), initializerSecret = randomBytes(32).toString('hex')
const runId = randomUUID(), children = [], clients = [], projects = []
mkdirSync(root + '.codex-build', { recursive: true })
const log = openSync(root + '.codex-build/file-explorer-local.log', 'w')
let gateway, user, team
async function until(predicate, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)) }
  throw new Error('FILE_EXPLORER_ACCEPTANCE_TIMEOUT')
}
async function api(path, method = 'GET', body, expected = 200, headers = {}) {
  const response = await fetch(base + path, { method, headers: {
    ...(user ? { Authorization: `Bearer ${user.accessToken}` } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers,
  }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) })
  assert.equal(response.status, expected, 'FILE_EXPLORER_API_STATUS')
  return response.status === 204 ? undefined : (await response.json()).data
}
function launch(args, env) {
  const child = spawn(args[0], args.slice(1), { cwd: root, env, stdio: ['ignore', log, log], windowsHide: true })
  children.push(child)
  return child
}
async function connect(project) {
  const ticket = await api(`/api/projects/${project.id}/collab-ticket`, 'POST')
  class OriginSocket extends WebSocket { constructor(url, protocols) { super(url, protocols, { origin }) } }
  const websocket = new HocuspocusProviderWebsocket({ url: 'ws://127.0.0.1:18599/collaboration', WebSocketPolyfill: OriginSocket, autoConnect: false, maxAttempts: 1 })
  const doc = new Y.Doc(), provider = new HocuspocusProvider({ websocketProvider: websocket, name: `project:${project.id}:epoch:${ticket.epoch}`, document: doc, token: ticket.ticket })
  const client = { websocket, doc, provider }
  clients.push(client); provider.attach(); void websocket.connect()
  await until(() => provider.isSynced)
  return client
}
async function stop(child) {
  if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited }
}
try {
  launch([process.execPath, root + 'collaboration/dist/server.js'], {
    ...process.env, COLLAB_INITIALIZER_SECRET: initializerSecret, COLLAB_INITIALIZER_PORT: '18600',
    COLLAB_INITIALIZER_NONCE_PATH: root + `.codex-build/file-explorer-initializer-${runId}.sqlite`,
  })
  const backend = launch(['java', '-jar', root + '.codex-build/step11-backend/backend-0.1.0-SNAPSHOT.jar', '--server.address=127.0.0.1', '--server.port=18598'], {
    ...process.env, ...config, AUTH_REDIS_NAMESPACE: 'file-explorer-acceptance:' + runId,
    COLLAB_CREATION_ENABLED: 'true', COLLAB_TICKET_ENABLED: 'true', COLLAB_GATEWAY_ENABLED: 'true', COLLAB_MAINTENANCE_ENABLED: 'false',
    COLLAB_INITIALIZER_URL: 'http://127.0.0.1:18600/internal/initialize', COLLAB_GATEWAY_INTERNAL_URL: 'http://127.0.0.1:18599',
    COLLAB_STORAGE_SECRET: storageSecret, COLLAB_GATEWAY_SECRET: gatewaySecret, COLLAB_INITIALIZER_SECRET: initializerSecret,
  })
  await until(async () => {
    if (backend.exitCode !== null) throw new Error('FILE_EXPLORER_BACKEND_EXITED')
    try { return (await fetch(base + '/api/health/readiness')).ok } catch { return false }
  }, 60000)
  gateway = createGateway({ enabled: true, origins: [origin], port: 18599, address: '127.0.0.1', springUrl: base,
    storageSecret, gatewaySecret, noncePath: root + `.codex-build/file-explorer-gateway-${runId}.sqlite`,
    maxRooms: 5, maxConnections: 10, maxRoomConnections: 5, maxMemoryBytes: 128 * 1024 * 1024, maxMessagesPerSecond: 100, maxBytesPerSecond: 4 * 1024 * 1024 })
  await gateway.server.listen()
  const name = 'explorer_' + randomBytes(6).toString('hex'), password = randomBytes(20).toString('hex')
  await api('/api/auth/register', 'POST', { username: name, email: name + '@example.test', password }, 201)
  user = await api('/api/auth/login', 'POST', { login: name, password })
  team = await api('/api/teams', 'POST', { name: 'File explorer acceptance ' + runId }, 201)
  const project = await api(`/api/teams/${team.id}/projects`, 'POST', { name: 'Explorer directory persistence', template: 'vanilla', entry: '/index.html' }, 201)
  projects.push(project)
  const a = await connect(project), b = await connect(project)
  a.doc.getMap('directories').set('/empty/nested', true)
  await until(() => readDirectories(b.doc).includes('/empty/nested'))
  const id = randomUUID()
  a.doc.transact(() => {
    const file = new Y.Map([['id', id], ['path', '/src/a.js'], ['language', 'javascript'], ['deletedAt', null], ['content', new Y.Text('const value = 42')]])
    a.doc.getMap('files').set(id, file); a.doc.getArray('fileOrder').push([id])
  })
  await until(() => b.doc.getMap('files').has(id))
  a.doc.transact(() => {
    a.doc.getMap('files').get(id).set('path', '/lib/a.js')
    a.doc.getMap('directories').set('/lib/empty', true)
  })
  await until(() => b.doc.getMap('files').get(id).get('path') === '/lib/a.js')
  a.doc.getMap('files').get(id).set('deletedAt', Date.now())
  await until(() => b.doc.getMap('files').get(id).get('deletedAt') !== null)
  a.doc.getMap('files').get(id).set('deletedAt', null)
  await until(() => b.doc.getMap('files').get(id).get('deletedAt') === null)
  const room = gateway.rooms.get(`project:${project.id}:epoch:1`)
  await until(() => room.doc.getMap('files').get(id)?.get('deletedAt') === null)
  await room.flush()
  const storage = new SpringApi(base, storageSecret), pointer = await storage.describe(project.id)
  const persisted = loadDocument(await storage.load(pointer), pointer)
  assert.deepEqual(readDirectories(persisted), ['/empty/nested', '/lib/empty'])
  assert.equal(persisted.getMap('files').get(id).get('content').toString(), 'const value = 42')
  persisted.destroy()
  const copy = await api(`/api/teams/${team.id}/projects/${project.id}/copy`, 'POST', { name: 'Explorer copied directories' }, 201)
  projects.push(copy)
  const copyPointer = await storage.describe(copy.id), copied = loadDocument(await storage.load(copyPointer), copyPointer)
  assert.deepEqual(readDirectories(copied), ['/empty/nested', '/lib/empty'])
  assert.ok([...copied.getMap('files').values()].some(file => file.get('path') === '/lib/a.js'))
  copied.destroy()
  console.log('FILE_EXPLORER_LOCAL_ACCEPTANCE_PASSED: local MySQL/MinIO/Redis, two-client directory sync, rename/delete/restore, durable reload and project copy')
} catch {
  console.error('FILE_EXPLORER_LOCAL_ACCEPTANCE_FAILED: inspect restricted .codex-build/file-explorer-local.log')
  process.exitCode = 1
} finally {
  for (const project of projects) {
    try { await api(`/api/teams/${team.id}/projects/${project.id}`, 'DELETE', undefined, 204, { 'If-Match': `"project-${project.id}-${project.stateVersion}"` }) } catch { process.exitCode = 1 }
  }
  clients.forEach(({ provider, websocket, doc }) => { provider.destroy(); websocket.destroy(); doc.destroy() })
  if (gateway) await gateway.stop()
  for (const child of children.reverse()) await stop(child)
  closeSync(log)
}
