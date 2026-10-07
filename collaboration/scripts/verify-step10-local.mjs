import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync, openSync, closeSync, mkdirSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { createGateway } from '../dist/gateway.js'
import { SpringApi, InternalFailure } from '../dist/internal.js'
import { loadDocument } from '../dist/document.js'
import { signature } from '../dist/hmac.js'
import { maintenanceClient } from './maintenance-client.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url)), collab = fileURLToPath(new URL('../', import.meta.url))
const config = parseEnv(readFileSync(root + '/.env', 'utf8'))
mkdirSync(root + '/.codex-build', { recursive: true })
const storageSecret = randomBytes(32).toString('hex'), gatewaySecret = randomBytes(32).toString('hex')
const initializerSecret = randomBytes(32).toString('hex'), maintenanceSecret = randomBytes(32).toString('hex')
const base = 'http://127.0.0.1:18090', origin = 'http://localhost:5173'
const env = { ...process.env, ...config, COLLAB_CREATION_ENABLED: 'true', COLLAB_TICKET_ENABLED: 'true', COLLAB_GATEWAY_ENABLED: 'true',
  COLLAB_MAINTENANCE_ENABLED: 'false', COLLAB_MAINTENANCE_SECRET: maintenanceSecret,
  COLLAB_GATEWAY_INTERNAL_URL: 'http://127.0.0.1:18097', COLLAB_INITIALIZER_URL: 'http://127.0.0.1:18096/internal/initialize',
  COLLAB_STORAGE_SECRET: storageSecret, COLLAB_GATEWAY_SECRET: gatewaySecret, COLLAB_INITIALIZER_SECRET: initializerSecret }
const encoderEnv = {}
for (const key of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP']) if (process.env[key]) encoderEnv[key] = process.env[key]
Object.assign(encoderEnv, { COLLAB_INITIALIZER_SECRET: initializerSecret, COLLAB_INITIALIZER_PORT: '18096', COLLAB_INITIALIZER_NONCE_PATH: root + '/.codex-build/step10-initializer-nonces.sqlite' })
const initializer = spawn(process.execPath, [collab + '/dist/server.js'], { cwd: collab, env: encoderEnv, stdio: 'ignore', windowsHide: true })
const descriptors = [], clients = []
let backend, gateway, vite, target
const options = { enabled: true, origins: [origin, 'http://127.0.0.1:15174'], port: 18097, address: '127.0.0.1', springUrl: base,
  storageSecret, gatewaySecret, noncePath: root + '/.codex-build/step10-gateway-nonces.sqlite',
  maxRooms: 10, maxConnections: 30, maxRoomConnections: 10, maxMemoryBytes: 1024 * 1024 * 1024,
  maxMessagesPerSecond: 100, maxBytesPerSecond: 4 * 1024 * 1024 }
const storage = new SpringApi(base, storageSecret), maintenance = maintenanceClient(base, maintenanceSecret)
async function until(predicate, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)) }
  throw new Error('STEP10_CONDITION_TIMEOUT')
}
async function start(mode) {
  const log = openSync(root + '/.codex-build/step10-local-' + mode + '.log', 'w'); descriptors.push(log)
  const selected = { ...env }
  if (mode === 'maintenance') Object.assign(selected, { COLLAB_CREATION_ENABLED: 'false', COLLAB_TICKET_ENABLED: 'false', COLLAB_GATEWAY_ENABLED: 'false', COLLAB_MAINTENANCE_ENABLED: 'true' })
  backend = spawn('java', ['-jar', root + '/.codex-build/step10-backend/backend-0.1.0-SNAPSHOT.jar', '--server.address=127.0.0.1', '--server.port=18090'],
    { cwd: root, env: selected, stdio: ['ignore', log, log], windowsHide: true })
  await until(async () => {
    if (backend.exitCode !== null) throw new Error('STEP10_BACKEND_EXITED')
    try { return (await fetch(base + '/api/health/readiness')).ok } catch { return false }
  }, 60000)
}
async function api(user, path, method = 'GET', body, expected = 200) {
  const response = await fetch(base + path, { method, headers: { ...(user ? { Authorization: 'Bearer ' + user.token } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) })
  assert.equal(response.status, expected, 'STEP10_API_STATUS')
  const result = response.status === 204 ? undefined : await response.json(); return result?.data
}
async function connect(user, id) {
  const ticket = await api(user, `/api/projects/${id}/collab-ticket`, 'POST')
  class OriginSocket extends WebSocket { constructor(url, protocols) { super(url, protocols, { origin }) } }
  const websocket = new HocuspocusProviderWebsocket({ url: 'ws://127.0.0.1:18097/collaboration', WebSocketPolyfill: OriginSocket, autoConnect: false, maxAttempts: 1 })
  const doc = new Y.Doc(), provider = new HocuspocusProvider({ websocketProvider: websocket, name: `project:${id}:epoch:${ticket.epoch}`, document: doc, token: ticket.ticket })
  clients.push({ provider, websocket, doc }); provider.attach(); void websocket.connect(); await until(() => provider.isSynced)
  return { provider, doc }
}
function destroyClients() { for (const c of clients.splice(0)) { c.provider.destroy(); c.websocket.destroy(); c.doc.destroy() } }
async function stop(child) { if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited } }
try {
  await start('normal'); gateway = createGateway(options); await gateway.server.listen()
  const name = 's10_' + randomBytes(5).toString('hex'), password = randomBytes(20).toString('hex')
  await api(null, '/api/auth/register', 'POST', { username: name, password }, 201)
  const credentials = await api(null, '/api/auth/login', 'POST', { login: name, password })
  const user = { token: credentials.accessToken }, team = await api(user, '/api/teams', 'POST', { name: 'Step10 acceptance' }, 201)
  const project = await api(user, `/api/teams/${team.id}/projects`, 'POST', { name: 'Step10 recovery', template: 'vanilla', entry: '/index.html' }, 201)
  const client = await connect(user, project.id), room = gateway.rooms.get(`project:${project.id}:epoch:1`)
  const entry = client.doc.getMap('files').get(client.doc.getMap('meta').get('entryFileId')).get('content')
  const marker = '<!-- step10-current-content -->\n'
  const persist = room.api.persist.bind(room.api)
  room.api.persist = async () => { throw new InternalFailure('COLLAB_STORAGE_UNAVAILABLE') }
  entry.insert(0, marker); await until(() => room.pending.length > 0)
  await assert.rejects(room.flush()); assert.equal(room.paused, true); assert.ok(room.pending.length > 0)
  assert.ok(gateway.metrics.snapshot().persist_failure > 0)
  room.api.persist = persist; await room.flush()
  assert.equal(room.pending.length, 0); assert.equal(room.durableSequence, room.dirtySequence)
  const original = await storage.describe(project.id), originalBytes = await storage.load(original)
  const privateObject = new URL(config.MINIO_ENDPOINT ?? 'http://localhost:9000')
  privateObject.pathname = '/' + [config.MINIO_BUCKET ?? 'web-editor', ...`collab/projects/${original.projectId}/epochs/${original.epoch}/${original.generation}-${original.contentHash}.yjs`.split('/')].map(encodeURIComponent).join('/')
  assert.equal((await fetch(privateObject, { signal: AbortSignal.timeout(10000) })).status, 403, 'STEP10_MINIO_MUST_BE_PRIVATE')
  const stale = await api(user, `/api/projects/${project.id}/collab-ticket`, 'POST')
  const beforeMetrics = await maintenance('/internal/collaboration/metrics')
  assert.equal(beforeMetrics.redisAvailable, true); assert.ok(beforeMetrics.counters.ticket_issued > 0)
  assert.equal((await fetch(base + '/internal/collaboration/metrics')).status, 401)
  destroyClients(); await gateway.stop(); gateway = undefined; await stop(backend)
  await start('maintenance')
  await api(user, `/api/projects/${project.id}/collab-ticket`, 'POST', undefined, 503)
  await assert.rejects(storage.persist(original, randomUUID(), originalBytes))
  const backupId = 's10_' + randomBytes(5).toString('hex')
  const pinned = await maintenance(`/internal/collaboration/maintenance/projects/${project.id}/backups/${backupId}`, 'POST', { retainUntil: new Date(Date.now() + 86400000).toISOString() })
  const pinnedBytes = await maintenance(`/internal/collaboration/maintenance/projects/${project.id}/backups/${backupId}/object`, 'GET', undefined, true)
  assert.deepEqual(pinnedBytes, Buffer.from(originalBytes)); assert.equal(pinned.contentHash, original.contentHash)
  const operationId = randomUUID(), request = { operationId, epoch: original.epoch, generation: original.generation }
  const recovered = await maintenance(`/internal/collaboration/maintenance/projects/${project.id}/recover`, 'POST', request)
  assert.equal(recovered.epoch, 2); assert.equal(recovered.generation, 1); assert.ok(recovered.objectKey.includes('/epochs/2/1-'))
  assert.deepEqual(await maintenance(`/internal/collaboration/maintenance/projects/${project.id}/recover`, 'POST', request), recovered)
  const rebuiltBytes = await storage.load(recovered), doc = loadDocument(rebuiltBytes, recovered)
  assert.ok(doc.getMap('files').get(doc.getMap('meta').get('entryFileId')).get('content').toString().startsWith(marker)); doc.destroy()
  assert.deepEqual(await maintenance(`/internal/collaboration/maintenance/projects/${project.id}/backups/${backupId}/object`, 'GET', undefined, true), pinnedBytes)
  const afterMetrics = await maintenance('/internal/collaboration/metrics'); assert.equal(afterMetrics.counters.recovery_success, 1)
  const backupDirectory = root + '/.codex-build/step10-backup-' + randomBytes(5).toString('hex')
  const backupEnv = { ...process.env, COLLAB_MAINTENANCE_URL: base, COLLAB_MAINTENANCE_SECRET: maintenanceSecret }
  const backup = spawn(process.execPath, ['scripts/maintenance.mjs', 'backup', backupDirectory, 's10_full_' + randomBytes(5).toString('hex')],
    { cwd: collab, env: backupEnv, stdio: 'ignore', windowsHide: true })
  assert.equal((await once(backup, 'exit'))[0], 0, 'STEP10_BACKUP_TOOL_FAILED')
  const manifest = JSON.parse(readFileSync(backupDirectory + '/manifest.json', 'utf8'))
  assert.ok(manifest.projects.some(p => p.projectId === project.id)); assert.match(manifest.databaseHash, /^[a-f0-9]{64}$/)
  assert.ok(readFileSync(backupDirectory + '/database.sql').length > 0)
  await stop(backend); await start('reopened')
  await assert.rejects(storage.consume(stale.ticket, project.id, 1))
  await assert.rejects(storage.persist(original, randomUUID(), originalBytes))
  gateway = createGateway(options); await gateway.server.listen()
  const reopened = await connect(user, project.id)
  assert.equal(reopened.doc.getMap('meta').get('epoch'), 2)
  assert.ok(reopened.doc.getMap('files').get(reopened.doc.getMap('meta').get('entryFileId')).get('content').toString().startsWith(marker))
  if (process.argv.includes('--browser')) {
    const browserOrigin = 'http://127.0.0.1:15174', proxy = process.env.CDP_PROXY_URL ?? 'http://localhost:3456'
    const viteLog = openSync(root + '/.codex-build/step10-vite.log', 'w'); descriptors.push(viteLog)
    const viteEnv = { LOCAL_API_URL: base, LOCAL_COLLAB_URL: 'ws://127.0.0.1:18097', LOCAL_VITE_CACHE_DIR: root + '/.codex-build/step10-vite-cache' }
    for (const key of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP']) if (process.env[key]) viteEnv[key] = process.env[key]
    vite = spawn(process.execPath, [root + '/frontend/node_modules/vite/bin/vite.js', '--configLoader', 'runner', '--host', '127.0.0.1', '--port', '15174', '--strictPort'],
      { cwd: root + '/frontend', env: viteEnv, stdio: ['ignore', viteLog, viteLog], windowsHide: true })
    await until(async () => { try { return (await fetch(browserOrigin)).ok } catch { return false } })
    const cdp = async (path, body) => {
      const response = await fetch(proxy + path, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(30000) })
      const result = await response.json(); if (!response.ok || result.error) throw new Error('STEP10_BROWSER_FAILED'); return result
    }
    target = (await cdp('/new', browserOrigin + '/login')).targetId
    const evaluate = async code => (await cdp(`/eval?target=${target}`, `(async()=>{${code}})()`)).value
    await evaluate(`const {login}=await import('/src/api/auth.ts');await login(${JSON.stringify(name)},${JSON.stringify(password)});history.pushState(null,'',${JSON.stringify(`/teams/${team.id}/projects/${project.id}`)});window.dispatchEvent(new PopStateEvent('popstate'));return true;`)
    await until(async () => evaluate(`return document.querySelector('.v2-workspace-status')?.textContent.includes('在线')&&!!document.querySelector('.monaco-editor');`), 60000)
    await evaluate(`let fiber=document.querySelector('.v2-workspace')?.[Object.keys(document.querySelector('.v2-workspace')||{}).find(k=>k.startsWith('__reactFiber'))];while(fiber&&!fiber.memoizedProps?.session)fiber=fiber.return;const session=fiber.memoizedProps.session;session.mutate(doc=>{for(const file of doc.getMap('files').values()){if(file.get('path')==='/index.js'){const text=file.get('content');text.delete(0,text.length);text.insert(0,'console.log("Step10 preview isolation works");')}}});return true;`)
    await until(async () => evaluate(`return document.querySelector('.v2-preview-pane')?.textContent.includes('Step10 preview isolation works');`), 60000)
    const frames = await evaluate(`return [...document.querySelectorAll('.v2-preview-boundary iframe')].map(f=>({sandbox:f.getAttribute('sandbox'),referrerPolicy:f.referrerPolicy,src:f.src,parentReadable:(()=>{try{return !!f.contentWindow.document}catch{return false}})()}));`)
    assert.ok(frames.length > 0)
    for (const frame of frames) {
      assert.equal(frame.sandbox, 'allow-scripts allow-same-origin allow-forms'); assert.equal(frame.referrerPolicy, 'no-referrer')
      assert.equal(frame.parentReadable, false); assert.equal(new URL(frame.src).origin === browserOrigin, false)
    }
    await cdp(`/close?target=${target}`); target = undefined
    console.log('STEP10_BROWSER_PREVIEW_PASSED')
  }
  console.log(JSON.stringify({ step10: 'passed', projectId: project.id, epoch: 2, generation: 1, backupObjects: manifest.projects.length }))
} catch {
  console.error('STEP10_LOCAL_ACCEPTANCE_FAILED: inspect local logs without printing credentials.'); process.exitCode = 1
} finally {
  if (target) await fetch((process.env.CDP_PROXY_URL ?? 'http://localhost:3456') + `/close?target=${target}`).catch(() => {})
  destroyClients(); if (gateway) await gateway.stop().catch(() => {})
  await stop(vite); await stop(backend); await stop(initializer); for (const descriptor of descriptors) closeSync(descriptor)
}
