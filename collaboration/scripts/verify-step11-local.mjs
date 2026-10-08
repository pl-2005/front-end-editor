import { createAuthFetch } from './auth-cookie-client.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync, openSync, closeSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID, createHash, createHmac } from 'node:crypto'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { createGateway } from '../dist/gateway.js'
import { SpringApi } from '../dist/internal.js'
import { loadDocument, validatePath } from '../dist/document.js'
import { releaseEdge } from './release-edge.mjs'
import { maintenanceClient } from './maintenance-client.mjs'
import { verifyRelease } from './release.mjs'

// Uses the root .env and installed local services. Credentials never leave process memory.
const root = fileURLToPath(new URL('../../', import.meta.url)), collab = fileURLToPath(new URL('../', import.meta.url))
const config = parseEnv(readFileSync(new URL('../../.env', import.meta.url), 'utf8'))
const frontendDirectory = process.env.STEP11_FRONTEND_DIR ?? root + '/.codex-build/step11-frontend'
mkdirSync(root + '/.codex-build', { recursive: true })
const storageSecret = randomBytes(32).toString('hex'), gatewaySecret = randomBytes(32).toString('hex'), initializerSecret = randomBytes(32).toString('hex')
const maintenanceSecret = randomBytes(32).toString('hex')
const base = 'http://127.0.0.1:18098', origin = 'http://127.0.0.1:15175'
const env = { ...process.env, ...config, AUTH_COOKIE_SECURE: 'false', AUTH_LOCAL_DEVELOPMENT: 'true', AUTH_ALLOWED_ORIGINS: origin, COLLAB_CREATION_ENABLED: 'true', COLLAB_TICKET_ENABLED: 'true', COLLAB_GATEWAY_ENABLED: 'true',
  COLLAB_GATEWAY_INTERNAL_URL: 'http://127.0.0.1:18099', COLLAB_INITIALIZER_URL: 'http://127.0.0.1:18100/internal/initialize',
  AUTH_REDIS_NAMESPACE: (config.AUTH_REDIS_NAMESPACE ?? 'web-editor:auth') + ':step11:' + randomBytes(6).toString('hex'),
  COLLAB_STORAGE_SECRET: storageSecret, COLLAB_GATEWAY_SECRET: gatewaySecret, COLLAB_INITIALIZER_SECRET: initializerSecret, COLLAB_MAINTENANCE_SECRET: maintenanceSecret, COLLAB_MAINTENANCE_ENABLED: 'false' }
const encoderEnv = {}
for (const key of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP']) if (process.env[key]) encoderEnv[key] = process.env[key]
Object.assign(encoderEnv, { COLLAB_INITIALIZER_SECRET: initializerSecret, COLLAB_INITIALIZER_PORT: '18100', COLLAB_INITIALIZER_NONCE_PATH: root + '/.codex-build/step11-initializer-nonces.sqlite' })
const initializer = spawn(process.execPath, [collab + '/dist/server.js'], { cwd: collab, env: encoderEnv, stdio: 'ignore', windowsHide: true })
const log = openSync(root + '/.codex-build/step11-local-backend.log', 'w')
let backend = spawn('java', ['-jar', root + '/.codex-build/step11-backend/backend-0.1.0-SNAPSHOT.jar', '--server.address=127.0.0.1', '--server.port=18098'],
  { cwd: root, env, stdio: ['ignore', log, log], windowsHide: true })
const storage = new SpringApi(base, storageSecret), clients = []
const options = { enabled: true, origins: [origin], port: 18099, address: '127.0.0.1', springUrl: base, storageSecret, gatewaySecret,
  noncePath: root + '/.codex-build/step11-gateway-nonces.sqlite', maxRooms: 10, maxConnections: 30, maxRoomConnections: 10,
  maxMemoryBytes: 1024 * 1024 * 1024, maxMessagesPerSecond: 100, maxBytesPerSecond: 4 * 1024 * 1024 }
let gateway, edge, target
async function until(predicate, timeout = 10000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)) }
  throw new Error('Step11 local acceptance condition timeout')
}
const authFetch = createAuthFetch(origin)
async function api(user, path, method = 'GET', body, expected = 200, headers = {}) {
  const response = await authFetch(origin + path, { method, headers: { ...(user ? { Authorization: `Bearer ${user.token}` } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) })
  const result = response.status === 204 ? undefined : await response.json()
  assert.equal(response.status, expected, `${method} ${path}: ${result?.code ?? 'unexpected status'}`)
  return result?.data
}
async function account(label) {
  const name = 's11_' + label + '_' + randomBytes(5).toString('hex'), password = randomBytes(20).toString('hex')
  await api(null, '/api/auth/register', 'POST', { username: name, email: name + '@example.test', password }, 201)
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
  const websocket = new HocuspocusProviderWebsocket({ url: 'ws://127.0.0.1:15175/collaboration', WebSocketPolyfill: OriginSocket, autoConnect: false, maxAttempts: 1 })
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
async function rejectedHandshake(ticket, projectId, originOverride = origin) {
  class OriginSocket extends WebSocket { constructor(url, protocols) { super(url, protocols, { origin: originOverride }) } }
  const websocket = new HocuspocusProviderWebsocket({ url: 'ws://127.0.0.1:15175/collaboration', WebSocketPolyfill: OriginSocket, autoConnect: false, maxAttempts: 1 })
  const doc = new Y.Doc(), provider = new HocuspocusProvider({ websocketProvider: websocket, name: `project:${projectId}:epoch:${ticket.epoch}`, document: doc, token: ticket.ticket })
  let rejected = false
  provider.on('authenticationFailed', () => { rejected = true })
  provider.on('close', ({ event }) => { if (event.code >= 4400) rejected = true })
  try { provider.attach(); void websocket.connect(); await until(() => rejected); assert.equal(provider.isSynced, false) }
  finally { provider.destroy(); websocket.destroy(); doc.destroy() }
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
const checks = [], passed = label => { checks.push(label); console.log('PASS: ' + label) }
let baselineRevisions, legacyId
async function mysql(sql) {
  const db = new URL(config.DB_URL.replace(/^jdbc:/, ''))
  assert.ok(['localhost', '127.0.0.1'].includes(db.hostname), 'STEP11_LOCAL_MYSQL_REQUIRED')
  const executable = config.MYSQL_PATH ?? config.MYSQLDUMP_PATH?.replace(/mysqldump(\.exe)?$/i, 'mysql$1') ?? 'mysql'
  const mysqlEnv = { MYSQL_PWD: config.DB_PASSWORD ?? '' }
  for (const key of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP']) if (process.env[key]) mysqlEnv[key] = process.env[key]
  const child = spawn(executable, ['--batch', '--skip-column-names', '--host=' + db.hostname, '--port=' + (db.port || '3306'),
    '--user=' + config.DB_USERNAME, db.pathname.slice(1), '--execute=' + sql], { env: mysqlEnv, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
  let output = ''
  child.stdout.on('data', bytes => { output += bytes.toString() })
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', () => reject(new Error('STEP11_MYSQL_FAILED'))) })
  assert.equal(code, 0, 'STEP11_MYSQL_FAILED')
  return output.trim().split(/\s+/).filter(Boolean).map(value => { assert.match(value, /^\d+$/, 'STEP11_MYSQL_RESULT_INVALID'); return Number(value) })
}
async function identityAcceptance(owner, member, teamId) {
  const latest = await mysql("SELECT MAX(CAST(version AS UNSIGNED)) FROM flyway_schema_history WHERE success=1; SELECT COUNT(*) FROM project_revision; SELECT COALESCE(MIN(id),0) FROM project WHERE team_id IS NULL;")
  assert.equal(latest[0], 13); baselineRevisions = latest[1]; legacyId = latest[2]
  await api(null, '/api/teams', 'GET', undefined, 401)
  const refreshed = await api(owner, '/api/auth/refresh', 'POST', {})
  owner.token = refreshed.accessToken; assert.equal(refreshed.refreshToken, undefined, 'STEP11_REFRESH_JSON_LEAK')
  const request = await api(member, `/api/teams/${teamId}/join-requests`, 'POST', undefined, 201)
  await api(member, `/api/teams/${teamId}/projects`, 'GET', undefined, 404)
  await api(owner, `/api/teams/${teamId}/join-requests/${request.id}/approve`, 'POST', undefined, 204)
  const members = await api(owner, `/api/teams/${teamId}/members`)
  assert.equal(members.find(m => m.userId === owner.id).role, 'OWNER'); assert.equal(members.find(m => m.userId === member.id).role, 'MEMBER')
  await api(member, `/api/teams/${teamId}/join-policy`, 'PUT', { joinPolicy: 'INVITE_ONLY' }, 403)
  const recipient = await account('recipient')
  for (const identifier of [recipient.name, recipient.name + '@example.test']) {
    assert.equal((await api(owner, `/api/teams/${teamId}/invitees/lookup?identifier=${encodeURIComponent(identifier)}`)).userId, recipient.id)
  }
  for (const identifier of ['missing_' + randomBytes(6).toString('hex'), randomBytes(6).toString('hex') + '@example.test']) {
    await api(owner, `/api/teams/${teamId}/invitees/lookup?identifier=${identifier}`, 'GET', undefined, 404)
  }
  assert.equal((await api(owner, `/api/teams/${teamId}/invitations`)).length, 0)
  await api(owner, `/api/teams/${teamId}/invitations`, 'POST', { userId: 9007199254740991 }, 404)
  let invite = await api(owner, `/api/teams/${teamId}/invitations`, 'POST', { userId: recipient.id }, 201)
  assert.ok((await api(recipient, '/api/teams/invitations/me')).some(i => i.id === invite.id))
  await api(recipient, `/api/teams/${teamId}/projects`, 'GET', undefined, 404)
  await api(member, `/api/teams/invitations/${invite.id}/accept`, 'POST', undefined, 410)
  await api(recipient, `/api/teams/invitations/${invite.id}/reject`, 'POST', undefined, 204)
  await api(recipient, `/api/teams/invitations/${invite.id}/accept`, 'POST', undefined, 410)
  invite = await api(owner, `/api/teams/${teamId}/invitations`, 'POST', { userId: recipient.id }, 201)
  await api(owner, `/api/teams/${teamId}/invitations/${invite.id}`, 'DELETE', undefined, 204)
  await api(recipient, `/api/teams/invitations/${invite.id}/accept`, 'POST', undefined, 410)
  invite = await api(owner, `/api/teams/${teamId}/invitations`, 'POST', { userId: recipient.id }, 201)
  // Expire only this verifier's newly created invitation, never existing user data.
  await mysql(`UPDATE team_invitation SET expires_at=DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 2 DAY) WHERE id=${invite.id} AND team_id=${teamId}; SELECT 1;`)
  await api(recipient, `/api/teams/invitations/${invite.id}/accept`, 'POST', undefined, 410)
  invite = await api(owner, `/api/teams/${teamId}/invitations`, 'POST', { userId: recipient.id }, 201)
  await api(recipient, `/api/teams/invitations/${invite.id}/accept`, 'POST')
  await api(recipient, `/api/teams/invitations/${invite.id}/accept`, 'POST', undefined, 410)
  passed('registration/login/refresh, join approval, username/email invitations, target-only and expired/revoked/processed rejection')
  const project = await api(member, `/api/teams/${teamId}/projects`, 'POST', { name: 'Step11 member rights', template: 'vanilla', entry: '/index.html' }, 201)
  const pointer = await storage.describe(project.id), doc = loadDocument(await storage.load(pointer), pointer)
  assert.equal(pointer.generation, 1); assert.equal(pointer.epoch, 1); doc.destroy()
  const changed = await api(member, `/api/teams/${teamId}/projects/${project.id}`, 'PUT', { name: 'Step11 renamed by member', template: 'vanilla' }, 200,
    { 'If-Match': `"project-${project.id}-${project.stateVersion}"` })
  const copy = await api(member, `/api/teams/${teamId}/projects/${project.id}/copy`, 'POST', { name: 'Step11 member copy' }, 201)
  const copyPointer = await storage.describe(copy.id), copyDoc = loadDocument(await storage.load(copyPointer), copyPointer); copyDoc.destroy()
  await api(member, `/api/teams/${teamId}/projects/${project.id}`, 'DELETE', undefined, 204, { 'If-Match': `"project-${project.id}-${changed.stateVersion}"` })
  passed('OWNER/MEMBER project rights, initialized generation=1, metadata and authoritative document copy')
  for (const id of [copy.id, ...(legacyId ? [legacyId] : [])]) {
    for (const [path, method, body] of [[`/api/projects/${id}`, 'GET'], [`/api/projects/${id}/snapshot`, 'PUT', {}],
      [`/api/projects/${id}/revisions`, 'GET'], [`/api/projects/${id}/revisions/1/restore`, 'POST', {}]]) {
      await api(owner, path, method, body, 403)
    }
  }
  if (legacyId) await api(owner, `/api/teams/${teamId}/projects/${legacyId}`, 'GET', undefined, 404)
  for (const path of ['/internal', '/internal/collaboration/metrics', '/internal/initialize', '/.env', '/collab', '/collaboration/extra']) {
    assert.equal((await fetch(origin + path)).status, 404, 'STEP11_INTERNAL_ROUTE_EXPOSED')
  }
  assert.equal((await fetch(origin + '/assets/missing.js')).status, 404)
  const page = await fetch(origin + '/teams/' + teamId)
  assert.ok((await page.text()).includes('id="root"')); assert.equal(page.headers.get('cache-control'), 'no-store')
  passed('production SPA deep links, internal routes blocked, old anonymous/snapshot/revision routes fail closed')
}
const proxy = process.env.CDP_PROXY_URL ?? 'http://localhost:3456'
async function cdp(path, body) {
  const response = await fetch(proxy + path, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(30000) })
  const result = await response.json(); if (!response.ok || result.error) throw new Error('STEP11_BROWSER_FAILED'); return result
}
async function evaluate(code) { return (await cdp(`/eval?target=${target}`, `(async()=>{${code}})()`)).value }
async function browserAcceptance(owner, team, project) {
  target = (await cdp('/new', origin + '/login')).targetId
  await until(async () => evaluate(`return !!document.querySelector('input[name="login"]');`), 30000)
  await evaluate(`document.querySelector('input[name="login"]').value=${JSON.stringify(owner.name)};document.querySelector('input[name="password"]').value=${JSON.stringify(owner.password)};document.querySelector('form').requestSubmit();return true;`)
  await until(async () => evaluate(`return location.pathname==='/teams';`), 30000)
  await evaluate(`history.pushState(null,'',${JSON.stringify(`/teams/${team.id}/projects/${project.id}`)});window.dispatchEvent(new PopStateEvent('popstate'));return true;`)
  await until(async () => evaluate(`return ([...document.querySelectorAll('.v2-workspace-status [aria-label]')].map(e=>e.getAttribute('aria-label')).join(' ')).includes('在线')&&!!document.querySelector('.monaco-editor');`), 60000)
  await until(async () => evaluate(`let f=document.querySelector('.v2-workspace')?.[Object.keys(document.querySelector('.v2-workspace')||{}).find(k=>k.startsWith('__reactFiber'))];while(f&&!f.memoizedProps?.session)f=f.return;window.__step11Session=f?.memoizedProps.session;return !!window.__step11Session;`))
  const monacoAsset = readdirSync(frontendDirectory + '/assets').find(name => /^editor\.api-.*\.js$/.test(name))
  assert.ok(monacoAsset, 'STEP11_MONACO_ASSET_MISSING')
  assert.equal(await evaluate(`const module=await import(${JSON.stringify('/assets/' + monacoAsset)});window.__step11Editor=Object.values(module).find(v=>v&&typeof v.getModels==='function'&&typeof v.getModelMarkers==='function');return !!window.__step11Editor;`), true)
  async function editFile(path, code) {
    await evaluate(`const b=[...document.querySelectorAll('.v2-file-panel li>button')].find(b=>b.textContent.startsWith(${JSON.stringify(path)}));if(!b)throw new Error('Missing file');b.click();return true;`)
    await until(async () => evaluate(`return window.__step11Editor.getEditors()[0]?.getModel()?.uri.path.endsWith(${JSON.stringify(path)});`))
    await evaluate(`window.__step11Editor.getEditors()[0].getModel().setValue(${JSON.stringify(code)});return true;`)
  }
  for (const [path, code, column, expected] of [['/index.html', '<di', 4, 'div'], ['/styles.css', 'body { col }', 10, 'color'], ['/index.js', 'document.querySel', 18, 'querySelector']]) {
    await editFile(path, code)
    await evaluate(`const e=window.__step11Editor.getEditors()[0];e.focus();e.setPosition({lineNumber:1,column:${column}});e.trigger('acceptance','editor.action.triggerSuggest',{});return true;`)
    await until(async () => evaluate(`return [...document.querySelectorAll('.suggest-widget .monaco-list-row')].some(e=>e.textContent.includes(${JSON.stringify(expected)}));`), 30000)
    await evaluate(`window.__step11Editor.getEditors()[0].trigger('acceptance','hideSuggestWidget',{});return true;`)
  }
  await editFile('/index.js', '/** @type {number} */\nlet count = "wrong";\nconsole.log(count);')
  await until(async () => evaluate(`return window.__step11Editor.getModelMarkers({resource:window.__step11Editor.getEditors()[0].getModel().uri}).some(x=>String(x.code)==='2322');`), 30000)
  await editFile('/styles.css', 'body { unknown-prop: 1; color: #12345; }')
  await until(async () => evaluate(`return window.__step11Editor.getModelMarkers({resource:window.__step11Editor.getEditors()[0].getModel().uri}).length>=2;`), 30000)
  await editFile('/index.html', '<div typo="x"><span></div>')
  await until(async () => evaluate(`return window.__step11Editor.getModelMarkers({resource:window.__step11Editor.getEditors()[0].getModel().uri}).length>=2;`), 30000)
  await editFile('/styles.css', 'body { color: rgb(12, 34, 56); }')
  await editFile('/index.html', '<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="/styles.css"></head><body><h1>Step11 local release</h1><script type="module" src="/index.js"></script></body></html>')
  await editFile('/index.js', 'console.log("Step11 production preview ready");')
  passed('built HTML/CSS/JS workers, completions, diagnostics and JS checkJs')
  await evaluate(`window.__step11Session.mutate(doc=>{for(const f of doc.getMap('files').values())if(f.get('path')==='/index.js'){const t=f.get('content');t.delete(0,t.length);t.insert(0,'console.log("Step11 production preview ready");')}});return true;`)
  await until(async () => evaluate(`return document.querySelector('.v2-preview-pane')?.textContent.includes('Step11 production preview ready');`), 60000)
  await until(async () => evaluate(`return ([...document.querySelectorAll('.v2-workspace-status [aria-label]')].map(e=>e.getAttribute('aria-label')).join(' ')).includes('已持久化');`))
  assert.equal(await evaluate(`return !/版本列表|历史恢复|版本比较|检查点|回退版本/.test(document.body.textContent);`), true)
  const frames = await evaluate(`return [...document.querySelectorAll('.v2-preview-boundary iframe')].map(f=>({sandbox:f.getAttribute('sandbox'),policy:f.referrerPolicy,sameOrigin:new URL(f.src).origin===location.origin}));`)
  assert.ok(frames.length); for (const f of frames) { assert.equal(f.sandbox, 'allow-scripts allow-same-origin allow-forms'); assert.equal(f.policy, 'no-referrer'); assert.equal(f.sameOrigin, false) }
  // Reload loses memory credentials; persisted offline log is reopened only after explicit login.
  await evaluate(`window.__fetch=window.fetch;window.fetch=(input,...args)=>String(input).includes('collab-ticket')?Promise.reject(new TypeError('offline')):window.__fetch(input,...args);window.__step11Session.websocket.webSocket.close();return true;`)
  await until(async () => evaluate(`return window.__step11Session.state.connection==='offline';`))
  await evaluate(`window.__step11Session.mutate(doc=>{doc.getMap('files').get(doc.getMap('meta').get('entryFileId')).get('content').insert(0,'<!-- step11 offline reload -->\\n')});await window.__step11Session.flushLocal();return true;`)
  await cdp('/navigate?target=' + target, origin + '/login')
  await until(async () => evaluate(`return !!document.querySelector('input[name="login"]');`))
  await evaluate(`document.querySelector('input[name="login"]').value=${JSON.stringify(owner.name)};document.querySelector('input[name="password"]').value=${JSON.stringify(owner.password)};document.querySelector('form').requestSubmit();return true;`)
  await until(async () => evaluate(`return location.pathname==='/teams';`))
  await evaluate(`history.pushState(null,'',${JSON.stringify(`/teams/${team.id}/projects/${project.id}`)});window.dispatchEvent(new PopStateEvent('popstate'));return true;`)
  await until(async () => evaluate(`return ([...document.querySelectorAll('.v2-workspace-status [aria-label]')].map(e=>e.getAttribute('aria-label')).join(' ')).includes('已持久化');`), 60000)
  await until(async () => {
    const p = await storage.describe(project.id), d = loadDocument(await storage.load(p), p)
    const found = d.getMap('files').get(d.getMap('meta').get('entryFileId')).get('content').toString().includes('step11 offline reload'); d.destroy(); return found
  })
  await cdp(`/screenshot?target=${target}&file=${encodeURIComponent(root + '/.codex-build/step11-production-workspace.png')}`)
  await cdp(`/close?target=${target}`); target = undefined
  passed('built frontend login, Monaco/Preview/Console, durable UI, isolated preview, offline reload and explicit reauthorization')
}
async function finishAcceptance({ owner, member, team, project, live, empty }) {
  if (process.argv.includes('--browser')) await browserAcceptance(owner, team, live)
  assert.equal((await mysql('SELECT COUNT(*) FROM project_revision;'))[0], baselineRevisions, 'STEP11_REVISION_WRITTEN')
  const invalid = await mysql("SELECT COUNT(*) FROM project p LEFT JOIN collab_document d ON d.project_id=p.id WHERE p.team_id IS NOT NULL AND p.status=1 AND (d.project_id IS NULL OR p.current_version<>0 OR p.current_object_key IS NOT NULL);")
  assert.equal(invalid[0], 0, 'STEP11_ACTIVE_PROJECT_INVALID')
  passed('active team project pointers present, V1 storage columns unused and no new project_revision')
  destroyClients(); await gateway.stop(); gateway = undefined; await stop(backend)
  const maintenanceEnv = { ...env, COLLAB_CREATION_ENABLED: 'false', COLLAB_TICKET_ENABLED: 'false', COLLAB_GATEWAY_ENABLED: 'false', COLLAB_MAINTENANCE_ENABLED: 'true' }
  backend = spawn('java', ['-jar', root + '/.codex-build/step11-backend/backend-0.1.0-SNAPSHOT.jar', '--server.address=127.0.0.1', '--server.port=18098'],
    { cwd: root, env: maintenanceEnv, stdio: ['ignore', log, log], windowsHide: true })
  await until(async () => { try { return (await fetch(base + '/api/health/readiness')).ok } catch { return false } }, 60000)
  const maintenance = maintenanceClient(base, maintenanceSecret), metrics = await maintenance('/internal/collaboration/metrics')
  assert.equal(metrics.redisAvailable, true)
  await api(owner, `/api/projects/${live.id}/collab-ticket`, 'POST', undefined, 503)
  const backupDirectory = root + '/.codex-build/step11-backup-' + randomBytes(5).toString('hex')
  const backup = spawn(process.execPath, ['scripts/maintenance.mjs', 'backup', backupDirectory, 's11_full_' + randomBytes(5).toString('hex')],
    { cwd: collab, env: { ...process.env, COLLAB_MAINTENANCE_URL: base, COLLAB_MAINTENANCE_SECRET: maintenanceSecret }, stdio: 'ignore', windowsHide: true })
  assert.equal((await once(backup, 'exit'))[0], 0, 'STEP11_JOINT_BACKUP_FAILED')
  const manifest = JSON.parse(readFileSync(backupDirectory + '/manifest.json', 'utf8'))
  assert.ok(manifest.projects.some(p => p.projectId === live.id)); assert.ok(manifest.projects.some(p => p.projectId === project.id && !p.active))
  assert.match(manifest.databaseHash, /^[a-f0-9]{64}$/)
  passed('maintenance rejects public writes, joint MySQL/Y.Doc backup and all current objects validated')
  const releaseDirectory = root + '/.codex-build/step11-release-' + randomBytes(5).toString('hex')
  const packed = spawn(process.execPath, ['scripts/release.mjs', 'pack', releaseDirectory, '.codex-build/step11-backend/backend-0.1.0-SNAPSHOT.jar', frontendDirectory],
    { cwd: collab, stdio: 'ignore', windowsHide: true })
  assert.equal((await once(packed, 'exit'))[0], 0, 'STEP11_RELEASE_PACK_FAILED')
  const release = verifyRelease(releaseDirectory)
  // Re-deploy the exact verified authenticated release. There is no older production rollback candidate yet.
  await stop(backend)
  backend = spawn('java', ['-jar', releaseDirectory + '/backend/backend.jar', '--server.address=127.0.0.1', '--server.port=18098'],
    { cwd: root, env, stdio: ['ignore', log, log], windowsHide: true })
  await until(async () => { try { return (await fetch(base + '/api/health/readiness')).ok } catch { return false } }, 60000)
  await api(null, '/api/teams', 'GET', undefined, 401)
  await api(owner, `/api/projects/${live.id}/snapshot`, 'PUT', {}, 403)
  await api(owner, `/api/projects/${live.id}/revisions`, 'GET', undefined, 403)
  await api(member, `/api/teams/${team.id}/projects/${live.id}`, 'GET', undefined, 401)
  const before = await storage.describe(live.id)
  gateway = createGateway(options); await gateway.server.listen(); const reopened = await connect(owner, live.id)
  assert.equal(reopened.doc.getMap('meta').get('epoch'), before.epoch)
  passed('verified release restart preserves authentication, revoked-user denial, legacy API isolation and current Y.Doc')
  const secrets = [storageSecret, gatewaySecret, initializerSecret, maintenanceSecret, owner.password, owner.token, owner.refresh,
    ...Object.entries(config).filter(([k]) => /SECRET|PASSWORD|ACCESS_KEY/.test(k)).map(([, v]) => v)].filter(v => v && v.length >= 8)
  const publicFiles = [frontendDirectory + '/index.html', ...readdirSync(frontendDirectory + '/assets').map(name => frontendDirectory + '/assets/' + name)]
  // Short local passwords can coincide with library alphabets/identifiers. Prove environment
  // isolation by rebuilding with unique canaries and comparing every public byte as well.
  const probeDirectory = root + '/.codex-build/step11-secret-probe-' + randomBytes(5).toString('hex'), probeEnv = { ...process.env }
  const canaries = Object.keys(config).filter(k => /SECRET|PASSWORD|ACCESS_KEY/.test(k)).map(key => {
    const value = 'step11_canary_' + randomBytes(32).toString('hex'); probeEnv[key] = value; return value
  })
  const probe = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--configLoader', 'runner', '--outDir', probeDirectory],
    { cwd: root + '/frontend', env: probeEnv, stdio: 'ignore', windowsHide: true })
  assert.equal((await once(probe, 'exit'))[0], 0, 'STEP11_SECRET_PROBE_BUILD_FAILED')
  for (const path of publicFiles) {
    const bytes = readFileSync(path), probeBytes = readFileSync(probeDirectory + path.slice(frontendDirectory.length))
    assert.ok(secrets.filter(s => s.length >= 24).every(s => !bytes.includes(Buffer.from(s))), 'STEP11_SECRET_IN_STATIC_ASSET')
    assert.ok(canaries.every(s => !probeBytes.includes(Buffer.from(s))), 'STEP11_ENV_SECRET_IN_PUBLIC_BUILD')
    assert.ok(bytes.equals(probeBytes), 'STEP11_SECRET_CHANGED_PUBLIC_BUILD')
  }
  const logBytes = readFileSync(root + '/.codex-build/step11-local-backend.log')
  assert.ok(secrets.every(s => !logBytes.includes(Buffer.from(s))), 'STEP11_SECRET_IN_LOG')
  passed('credentials absent from built public assets and application log')
  const report = { step11: 'local-acceptance-passed', createdAt: new Date().toISOString(), browser: process.argv.includes('--browser'), production: 'not-deployed-no-target',
    historicalRollbackCandidate: null, flyway: release.compatibility.flyway, checks, projectIds: [project.id, empty.id, live.id], releaseDirectory, backupDirectory, backupObjects: manifest.projects.length }
  writeFileSync(root + '/.codex-build/step11-acceptance.json', JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ step11: report.step11, browser: report.browser, checks: checks.length, backupObjects: report.backupObjects }))
}
try {
  edge = releaseEdge({ directory: frontendDirectory, apiPort: 18098, gatewayPort: 18099 }); await new Promise(resolve => edge.listen(15175, "127.0.0.1", resolve))
  await until(async () => {
    if (backend.exitCode !== null) throw new Error('Backend exited; inspect .codex-build/step11-local-backend.log')
    try { return (await fetch(base + '/api/health')).ok } catch { return false }
  }, 60000)
  gateway = createGateway(options); await gateway.server.listen()
  const owner = await account('owner'), member = await account('member')
  const team = await api(owner, '/api/teams', 'POST', { name: 'Step11 acceptance' }, 201)
  await identityAcceptance(owner, member, team.id)
  const project = await api(owner, `/api/teams/${team.id}/projects`, 'POST', { name: 'Step11 delete', template: 'vanilla', entry: '/index.html' }, 201)
  const a = await connect(owner, project.id), b = await connect(member, project.id)
  const fileId = randomUUID()
  b.doc.transact(() => {
    const file = new Y.Map()
    file.set('id', fileId); file.set('path', '/member.js'); file.set('language', validatePath('/member.js'))
    file.set('deletedAt', null); file.set('content', new Y.Text('console.log("member file");'))
    b.doc.getMap('files').set(fileId, file); b.doc.getArray('fileOrder').push([fileId])
  })
  await until(() => a.doc.getMap('files').has(fileId))
  a.doc.transact(() => a.doc.getMap('files').get(fileId).set('path', '/renamed.js'))
  await until(() => b.doc.getMap('files').get(fileId).get('path') === '/renamed.js')
  b.doc.getMap('files').get(fileId).get('content').insert(0, '// member text\n')
  await until(() => a.doc.getMap('files').get(fileId).get('content').toString().startsWith('// member text'))
  const entryId = a.doc.getMap('meta').get('entryFileId'), text = a.doc.getMap('files').get(entryId).get('content')
  a.provider.awareness.setLocalState({ activeFileId: entryId, selection: { anchor: Y.createRelativePositionFromTypeIndex(text, 0), head: Y.createRelativePositionFromTypeIndex(text, 1) } })
  await until(() => [...b.provider.awareness.getStates().values()].some(state => state.user?.id === owner.id && state.selection?.anchor))
  b.doc.transact(() => b.doc.getMap('files').get(fileId).set('deletedAt', Date.now()))
  await until(() => a.doc.getMap('files').get(fileId).get('deletedAt') !== null)
  passed('two identities collaborate on text and file create/rename/delete with authorized Presence/relative cursor')
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
  await rejectedHandshake(old, project.id)
  await assert.rejects(storage.consume(old.ticket, project.id, 1))
  await api(owner, `/api/projects/${project.id}/collab-ticket`, 'POST', undefined, 403)
  await api(member, `/api/teams/${team.id}/projects/${project.id}`, 'DELETE', undefined, 204, { 'If-Match': key })
  const empty = await api(owner, `/api/teams/${team.id}/projects`, 'POST', { name: 'Step11 empty delete', template: 'vanilla', entry: '/index.html' }, 201)
  await api(owner, `/api/teams/${team.id}/projects/${empty.id}`, 'DELETE', undefined, 204, { 'If-Match': `"project-${empty.id}-${empty.stateVersion}"` })
  const live = await api(owner, `/api/teams/${team.id}/projects`, 'POST', { name: 'Step11 revoke', template: 'vanilla', entry: '/index.html' }, 201)
  let valid = await connect(owner, live.id), revoked = await connect(member, live.id)
  const stale = await api(member, `/api/projects/${live.id}/collab-ticket`, 'POST')
  await api(owner, `/api/teams/${team.id}/members/${member.id}`, 'DELETE', undefined, 204)
  await until(() => revoked.closed); assert.equal(valid.provider.isSynced, true)
  assert.equal(revoked.closeReason, 'COLLAB_USER_REVOKED', 'member removal must use the active Outbox event')
  await rejectedHandshake(stale, live.id)
  await assert.rejects(storage.consume(stale.ticket, live.id, 1))
  await api(member, `/api/projects/${live.id}/collab-ticket`, 'POST', undefined, 403)
  await api(member, `/api/teams/${team.id}/projects/${live.id}`, 'GET', undefined, 404)
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
  await api(member, '/api/auth/logout', 'POST', {}, 200)
  await until(() => revoked.closed); assert.equal(valid.provider.isSynced, true)
  assert.equal(revoked.closeReason, 'COLLAB_USER_REVOKED', 'logout must use the active Outbox event')
  edit(valid, '<!-- live after all revocations -->\n')
  await until(async () => (await storage.describe(live.id)).generation >= 2)
  destroyClients(); await gateway.stop(); gateway = createGateway(options); await gateway.server.listen()
  valid = await connect(owner, live.id)
  assert.ok(valid.doc.getMap('files').get(valid.doc.getMap('meta').get('entryFileId')).get('content').toString().startsWith('<!-- live after all revocations -->'))
  await assert.rejects(storage.describe(project.id))
  passed('durable delete, empty-room fence, idempotency, old tickets, all four revocations, unaffected member writes and restart recovery')
  await finishAcceptance({ owner, member, team, project, live, empty, gateway })
} catch (error) {
  console.error("STEP11_LOCAL_FAILED", error instanceof assert.AssertionError ? error.message : "check restricted local logs"); process.exitCode = 1
} finally {
  if (target) await cdp(`/close?target=${target}`).catch(() => {})
  destroyClients()
  if (edge) { edge.closeAllConnections(); await new Promise(resolve => edge.close(resolve)) }
  try { if (gateway) await gateway.stop() } finally { await stop(backend); await stop(initializer); closeSync(log) }
}
