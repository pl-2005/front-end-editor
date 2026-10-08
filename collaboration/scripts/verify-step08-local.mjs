import { createAuthFetch } from './auth-cookie-client.mjs'
/** Browser acceptance using the web-access CDP proxy, root .env and local services.
 * No credentials are written to disk or printed. Accounts/projects remain for inspection. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync, openSync, closeSync, mkdirSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { createGateway } from '../dist/gateway.js'
import { SpringApi } from '../dist/internal.js'
import { loadDocument } from '../dist/document.js'

const root = fileURLToPath(new URL('../../', import.meta.url)), collab = fileURLToPath(new URL('../', import.meta.url))
const config = parseEnv(readFileSync(new URL('../../.env', import.meta.url), 'utf8'))
mkdirSync(root + '/.codex-build', { recursive: true })
const storageSecret = randomBytes(32).toString('hex'), gatewaySecret = randomBytes(32).toString('hex'), initializerSecret = randomBytes(32).toString('hex')
const base = 'http://127.0.0.1:18086', origin = 'http://127.0.0.1:15173', proxy = process.env.CDP_PROXY_URL || 'http://localhost:3456'
const env = { ...process.env, ...config, AUTH_COOKIE_SECURE: 'false', AUTH_LOCAL_DEVELOPMENT: 'true', AUTH_ALLOWED_ORIGINS: origin, COLLAB_CREATION_ENABLED: 'true', COLLAB_TICKET_ENABLED: 'true', COLLAB_GATEWAY_ENABLED: 'true',
  COLLAB_GATEWAY_INTERNAL_URL: 'http://127.0.0.1:18092', COLLAB_INITIALIZER_URL: 'http://127.0.0.1:18093/internal/initialize',
  COLLAB_STORAGE_SECRET: storageSecret, COLLAB_GATEWAY_SECRET: gatewaySecret, COLLAB_INITIALIZER_SECRET: initializerSecret }
const encoderEnv = {}
for (const key of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP']) if (process.env[key]) encoderEnv[key] = process.env[key]
Object.assign(encoderEnv, { COLLAB_INITIALIZER_SECRET: initializerSecret, COLLAB_INITIALIZER_PORT: '18093', COLLAB_INITIALIZER_NONCE_PATH: root + '/.codex-build/step08-initializer-nonces.sqlite' })
const initializer = spawn(process.execPath, [collab + '/dist/server.js'], { cwd: collab, env: encoderEnv, stdio: 'ignore', windowsHide: true })
const log = openSync(root + '/.codex-build/step08-local-backend.log', 'w')
const viteLog = openSync(root + '/.codex-build/step08-vite.log', 'w')
const backend = spawn('java', ['-jar', root + '/.codex-build/step08-backend/backend-0.1.0-SNAPSHOT.jar', '--server.address=127.0.0.1', '--server.port=18086'], { cwd: root, env, stdio: ['ignore', log, log], windowsHide: true })
let gateway, vite, token, target
const targets = []
const storage = new SpringApi(base, storageSecret)
const options = { enabled: true, origins: [origin], port: 18092, address: '127.0.0.1', springUrl: base, storageSecret, gatewaySecret,
  noncePath: root + '/.codex-build/step08-gateway-nonces.sqlite', maxRooms: 10, maxConnections: 20, maxRoomConnections: 10,
  maxMemoryBytes: 1024 * 1024 * 1024, maxMessagesPerSecond: 100, maxBytesPerSecond: 4 * 1024 * 1024 }
async function until(predicate, label, timeout = 20000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await predicate()) return; await new Promise(r => setTimeout(r, 150)) }
  throw new Error(`Acceptance timeout: ${label}`)
}
const authFetch = createAuthFetch(origin)
async function api(path, method = 'GET', body, expected = 200) {
  const response = await authFetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) })
  const result = response.status === 204 ? undefined : await response.json()
  assert.equal(response.status, expected, `${method} ${path}: ${result?.code ?? 'unexpected status'}`)
  return result?.data
}
async function cdp(path, body) {
  const response = await fetch(proxy + path, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(30000) })
  const result = await response.json()
  if (!response.ok || result.error) throw new Error(`Browser operation failed: ${result.error || response.status}`)
  return result
}
async function evaluate(code) { return (await cdp(`/eval?target=${target}`, `(async()=>{${code}})()`)).value }
const model = path => `m.editor.getModels().find(x=>x.uri.path.split('/').slice(5).join('/')===${JSON.stringify(path.slice(1))})`
async function edit(path, code) {
  await evaluate(`const button=[...document.querySelectorAll('.v2-file-panel li > button')].find(x=>x.textContent===${JSON.stringify(path)}||x.textContent===${JSON.stringify(path + '（入口）')});if(!button)throw new Error('File button missing');button.click();return true;`)
  await until(async () => evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts'); return m.editor.getEditors()[0]?.getModel()===${model(path)};`), 'active file')
  await evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts'); ${model(path)}.setValue(${JSON.stringify(code)}); return true;`)
}
async function click(label) {
  return evaluate(`const button=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(label)}||x.textContent===${JSON.stringify(label)}); if(!button) throw new Error('Button missing'); button.click(); return true;`)
}
async function prompt(value) { await evaluate(`window.prompt=()=>${JSON.stringify(value)}; window.confirm=()=>true; return true;`) }
async function durable() { await until(async () => (await evaluate(`return ([...document.querySelectorAll('.v2-workspace-status [aria-label]')].map(e=>e.getAttribute('aria-label')).join(' '))||'';`)).includes('已持久化'), 'durable confirmation') }
async function stop(child) { if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited } }
try {
  await until(async () => {
    if (backend.exitCode !== null) throw new Error('Backend exited; inspect local backend log')
    try { return (await fetch(base + '/api/health')).ok } catch { return false }
  }, 'backend', 60000)
  gateway = createGateway(options); await gateway.server.listen()
  const viteEnv = { LOCAL_API_URL: base, LOCAL_COLLAB_URL: 'ws://127.0.0.1:18092', LOCAL_VITE_CACHE_DIR: root + '/.codex-build/step08-vite-cache' }
  for (const key of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP']) if (process.env[key]) viteEnv[key] = process.env[key]
  vite = spawn(process.execPath, [root + '/frontend/node_modules/vite/bin/vite.js', '--configLoader', 'runner', '--host', '127.0.0.1', '--port', '15173', '--strictPort'], { cwd: root + '/frontend', env: viteEnv, stdio: ['ignore', viteLog, viteLog], windowsHide: true })
  await until(async () => { if (vite.exitCode !== null) throw new Error('Vite exited'); try { return (await fetch(origin)).ok } catch { return false } }, 'Vite')
  const username = 'step08_' + randomBytes(6).toString('hex'), password = randomBytes(20).toString('hex')
  await api('/api/auth/register', 'POST', { username, password }, 201)
  token = (await api('/api/auth/login', 'POST', { login: username, password })).accessToken
  const team = await api('/api/teams', 'POST', { name: 'Step08 acceptance' }, 201)
  const project = await api(`/api/teams/${team.id}/projects`, 'POST', { name: 'Step08 workspace', template: 'vanilla', entry: '/index.html' }, 201)
  const route = `/teams/${team.id}/projects/${project.id}`
  async function openWorkspace() {
    target = (await cdp('/new', origin + '/login')).targetId; targets.push(target)
    await evaluate(`const {login}=await import('/src/api/auth.ts');await login(${JSON.stringify(username)},${JSON.stringify(password)});history.pushState(null,'',${JSON.stringify(route)});window.dispatchEvent(new PopStateEvent('popstate'));return true;`)
    await evaluate(`window.confirm=()=>true;return true;`)
    await until(async () => evaluate(`return ([...document.querySelectorAll('.v2-workspace-status [aria-label]')].map(e=>e.getAttribute('aria-label')).join(' ')).includes('在线')&&!!document.querySelector('.monaco-editor');`), 'online workspace', 60000)
    await until(async () => evaluate(`let f=document.querySelector('.v2-workspace')?.[Object.keys(document.querySelector('.v2-workspace')||{}).find(k=>k.startsWith('__reactFiber'))];while(f&&!f.memoizedProps?.session)f=f.return;window.__step08Session=f?.memoizedProps.session;return !!window.__step08Session;`), 'workspace session')
  }
  await openWorkspace(); const first = target
  await durable()
  console.log('PASS: authenticated workspace and independent local/server persistence states')
  await edit('/index.html', '<!doctype html><html><head><meta charset="UTF-8"></head><body><h1>Step08 local preview</h1><script type="module" src="/index.js"></script></body></html>')
  await edit('/index.js', 'console.log("Step08 preview ready");'); await durable()
  await until(async () => evaluate(`return document.querySelector('.v2-preview-pane')?.textContent.includes('Step08 preview ready');`), 'preview runtime ready', 60000)
  // Keep HTTP application assets available while simulating a disconnected collaboration transport.
  await evaluate(`window.__originalFetch=window.fetch;window.fetch=(input,...args)=>String(input).includes('collab-ticket')?Promise.reject(new TypeError('simulated offline')):window.__originalFetch(input,...args);window.__step08Session.websocket.webSocket.close();return true;`)
  await until(async () => evaluate(`return window.__step08Session.state.connection==='offline'&&window.__step08Session.state.writable;`), 'offline writable')
  await prompt('/offline.js'); await click('新建文件'); await edit('/offline.js', 'console.log("offline retained");')
  await prompt('/offline.txt'); await click('重命名 /offline.js')
  await until(async () => evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts');return !!${model('/offline.txt')}&&!${model('/offline.js')};`), 'offline cross-extension rename')
  await edit('/index.html', '<!doctype html><html><head><meta charset="UTF-8"></head><body><h1>Step08 offline changed</h1><script type="module" src="/index.js"></script></body></html>')
  await edit('/index.js', 'console.log("Step08 offline runtime");')
  await until(async () => evaluate(`return document.querySelector('.v2-preview-pane')?.textContent.includes('Step08 offline runtime');`), 'local preview runtime during collaboration outage', 60000)
  await evaluate(`await window.__step08Session.flushLocal();return true;`)
  assert.equal(await evaluate(`return document.querySelector('.v2-preview-pane')?.textContent.includes('本地未同步')||false;`), true)
  assert.equal(await evaluate(`return window.__step08Session.state.synced;`), false)
  console.log('PASS: disconnected text/structure editing, cross-extension model lifecycle, bounded local log and preview label')
  await evaluate(`window.fetch=window.__originalFetch;await window.__step08Session.connect();return true;`)
  await durable()
  let pointer = await storage.describe(project.id), saved = loadDocument(await storage.load(pointer), { projectId: project.id, epoch: 1 })
  assert.ok([...saved.getMap('files').values()].some(f => f.get('path') === '/offline.txt' && f.get('content').toString().includes('offline retained'))); saved.destroy()
  console.log('PASS: fresh ticket, same-epoch merge and MySQL/MinIO current pointer')
  await openWorkspace(); const second = target
  target = first
  await until(async () => evaluate(`return window.__step08Session.state.members?.length===2;`), 'two distinct same-user tabs')
  assert.equal(await evaluate(`return new Set(window.__step08Session.state.members.map(m=>m.connectionId)).size;`), 2)
  await edit('/offline.txt', 'keep conflict content'); await durable()
  target = second; await edit('/offline.txt', 'keep conflict content')
  await evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts');const e=m.editor.getEditors()[0];e.setSelection(new m.Selection(1,1,1,5));return true;`)
  target = first
  await until(async () => evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts');return m.editor.getEditors()[0].getModel().getAllDecorations().some(d=>d.options.className?.startsWith('v2-remote-'));`), 'remote selection decorations')
  await until(async () => evaluate(`const label=document.querySelector('.v2-cursor-name');return label?.textContent===${JSON.stringify(username)}&&label.getBoundingClientRect().width>0;`), 'visible collaborator name')
  assert.equal(await evaluate(`const label=document.querySelector('.v2-cursor-name'),member=[...document.querySelectorAll('.v2-presence li')].find(x=>!x.textContent.includes('本标签页'));return getComputedStyle(label).color===getComputedStyle(member).borderLeftColor;`), true)
  target = second
  await evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts');m.editor.getEditors()[0].setPosition({lineNumber:1,column:8});return true;`)
  target = first
  await until(async () => evaluate(`return document.querySelector('.v2-cursor-name')?.getBoundingClientRect().width>0;`), 'name next to collapsed cursor')
  await edit('/index.js', 'console.log("Step08 offline runtime");')
  await until(async () => evaluate(`return document.querySelectorAll('.v2-cursor-name').length===0;`), 'cursor label cleared on file switch')
  await edit('/offline.txt', 'keep conflict content')
  await until(async () => evaluate(`return document.querySelector('.v2-cursor-name')?.textContent===${JSON.stringify(username)};`), 'cursor label restored on file switch')
  await cdp(`/screenshot?target=${target}&file=${encodeURIComponent(root + '/.codex-build/step08-cursor-label.png')}`)
  console.log('PASS: collaborator cursor/name colors, collapsed cursor label and file-switch cleanup')
  target = second
  await click('删除 /offline.txt')
  target = first
  await until(async () => evaluate(`return !!document.querySelector('.v2-recovery')&&window.__step08Session.state.recoveries?.[0]?.code==='keep conflict content';`), 'remote deletion recovery')
  await prompt('/recovered.txt'); await click('恢复为新文件'); await durable()
  assert.equal(await evaluate(`return window.__step08Session.state.recoveries.length;`), 0)
  console.log('PASS: online members, user/connection distinction, remote selection and remote-delete content recovery')
  target = second; await cdp(`/close?target=${target}`); target = first
  await until(async () => evaluate(`return window.__step08Session.state.members?.length===1;`), 'peer departure')
  // Fresh page loses in-memory credentials; explicitly reauthorize before reopening the persisted local log.
  await evaluate(`window.__originalFetch=window.fetch;window.fetch=(input,...args)=>String(input).includes('collab-ticket')?Promise.reject(new TypeError('simulated offline')):window.__originalFetch(input,...args);window.__step08Session.websocket.webSocket.close();return true;`)
  await until(async () => evaluate(`return window.__step08Session.state.connection==='offline';`), 'offline before reload')
  await edit('/recovered.txt', 'survives fresh page'); await evaluate(`await window.__step08Session.flushLocal();return true;`)
  await cdp('/navigate?target=' + first, origin + '/login')
  await evaluate(`const {login}=await import('/src/api/auth.ts');await login(${JSON.stringify(username)},${JSON.stringify(password)});history.pushState(null,'',${JSON.stringify(route)});window.dispatchEvent(new PopStateEvent('popstate'));return true;`)
  await until(async () => evaluate(`return ([...document.querySelectorAll('.v2-workspace-status [aria-label]')].map(e=>e.getAttribute('aria-label')).join(' ')).includes('在线');`), 'reload authorized merge')
  await durable()
  await until(async () => evaluate(`let f=document.querySelector('.v2-workspace')?.[Object.keys(document.querySelector('.v2-workspace')||{}).find(k=>k.startsWith('__reactFiber'))];while(f&&!f.memoizedProps?.session)f=f.return;window.__step08Session=f?.memoizedProps.session;return !!window.__step08Session;`), 'restored session')
  assert.equal(await evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts');return ${model('/recovered.txt')}.getValue();`), 'survives fresh page')
  console.log('PASS: page reload, explicit login, persisted local updates and authorized resend')
  await gateway.stop(); gateway = createGateway(options); await gateway.server.listen()
  await until(async () => evaluate(`return window.__step08Session.state.connection==='online';`), 'gateway restart'); await durable()
  pointer = await storage.describe(project.id); saved = loadDocument(await storage.load(pointer), { projectId: project.id, epoch: 1 })
  assert.ok([...saved.getMap('files').values()].some(f => f.get('path') === '/recovered.txt' && f.get('content').toString() === 'survives fresh page')); saved.destroy()
  console.log('PASS: gateway restart loads latest durable project files')
  await cdp(`/screenshot?target=${target}&file=${encodeURIComponent(root + '/.codex-build/step08-workspace.png')}`)
  await api('/api/auth/logout', 'POST', {}, 200)
  await until(async () => evaluate(`return window.__step08Session.state.connection==='forbidden'&&!document.querySelector('.monaco-editor');`), 'revocation clears editor', 10000)
  await until(async () => evaluate(`return !(await indexedDB.databases()).some(db=>db.name==='web-editor:'+window.__step08Session.userId+':${project.id}:1');`), 'revocation clears IndexedDB')
  assert.equal(await evaluate(`try{await window.__step08Session.exportFiles();return false}catch{return true}`), true)
  console.log('PASS: revoked session closes, memory/IndexedDB clear and export is denied')
  console.log(`Acceptance project ID: ${project.id}`)
} catch (error) {
  if (target) console.log('Browser status:', await evaluate(`return {status:([...document.querySelectorAll('.v2-workspace-status [aria-label]')].map(e=>e.getAttribute('aria-label')).join(' ')),error:document.querySelector('.v2-error')?.textContent,files:[...document.querySelectorAll('.v2-file-panel li>button')].map(x=>x.textContent)};`).catch(() => 'unavailable'))
  throw error
} finally {
  // Only acceptance tabs belong to this script; the proxy and user tabs stay open.
  for (const id of targets) await cdp(`/close?target=${id}`).catch(() => {})
  await stop(vite)
  if (gateway) await gateway.stop()
  await stop(backend); await stop(initializer); closeSync(log); closeSync(viteLog)
}
