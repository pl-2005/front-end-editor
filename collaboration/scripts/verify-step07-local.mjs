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
Object.assign(encoderEnv, { COLLAB_INITIALIZER_SECRET: initializerSecret, COLLAB_INITIALIZER_PORT: '18093', COLLAB_INITIALIZER_NONCE_PATH: root + '/.codex-build/step07-initializer-nonces.sqlite' })
const initializer = spawn(process.execPath, [collab + '/dist/server.js'], { cwd: collab, env: encoderEnv, stdio: 'ignore', windowsHide: true })
const log = openSync(root + '/.codex-build/step07-local-backend.log', 'w')
const viteLog = openSync(root + '/.codex-build/step07-vite.log', 'w')
const backend = spawn('java', ['-jar', root + '/.codex-build/step07-backend/backend-0.1.0-SNAPSHOT.jar', '--server.address=127.0.0.1', '--server.port=18086'], { cwd: root, env, stdio: ['ignore', log, log], windowsHide: true })
let gateway, vite, token, target
const storage = new SpringApi(base, storageSecret)
const options = { enabled: true, origins: [origin], port: 18092, address: '127.0.0.1', springUrl: base, storageSecret, gatewaySecret,
  noncePath: root + '/.codex-build/step07-gateway-nonces.sqlite', maxRooms: 10, maxConnections: 20, maxRoomConnections: 10,
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
async function markers(path) { return evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts'); return m.editor.getModelMarkers({resource:${model(path)}.uri}).map(x=>({message:x.message,code:x.code}));`) }
async function completion(path, code, offset, expected) {
  await edit(path, code)
  await evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts');const e=m.editor.getEditors()[0],model=${model(path)};e.setModel(model);e.setPosition(model.getPositionAt(${offset}));e.focus();e.trigger('acceptance','editor.action.triggerSuggest',{});return true;`)
  await until(async () => evaluate(`return [...document.querySelectorAll('.suggest-widget.visible .monaco-list-row')].some(x=>x.textContent.includes(${JSON.stringify(expected)}));`), `${path} completion`)
  await evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts');m.editor.getEditors()[0].trigger('acceptance','acceptSelectedSuggestion',{});return true;`)
  assert.notEqual(await evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts');return ${model(path)}.getValue();`), code)
  await durable()
}
async function stop(child) { if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited } }
try {
  await until(async () => {
    if (backend.exitCode !== null) throw new Error('Backend exited; inspect local backend log')
    try { return (await fetch(base + '/api/health')).ok } catch { return false }
  }, 'backend', 60000)
  gateway = createGateway(options); await gateway.server.listen()
  const viteEnv = { LOCAL_API_URL: base, LOCAL_COLLAB_URL: 'ws://127.0.0.1:18092' }
  for (const key of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP']) if (process.env[key]) viteEnv[key] = process.env[key]
  vite = spawn(process.execPath, [root + '/frontend/node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '15173', '--strictPort'], { cwd: root + '/frontend', env: viteEnv, stdio: ['ignore', viteLog, viteLog], windowsHide: true })
  await until(async () => { if (vite.exitCode !== null) throw new Error('Vite exited'); try { return (await fetch(origin)).ok } catch { return false } }, 'Vite')
  const username = 'step07_' + randomBytes(6).toString('hex'), password = randomBytes(20).toString('hex')
  await api('/api/auth/register', 'POST', { username, password }, 201)
  token = (await api('/api/auth/login', 'POST', { login: username, password })).accessToken
  const team = await api('/api/teams', 'POST', { name: 'Step07 acceptance' }, 201)
  const project = await api(`/api/teams/${team.id}/projects`, 'POST', { name: 'Step07 workspace', template: 'vanilla', entry: '/index.html' }, 201)
  target = (await cdp('/new', origin + '/login')).targetId
  await evaluate(`const {login}=await import('/src/api/auth.ts'); await login(${JSON.stringify(username)},${JSON.stringify(password)}); history.pushState(null,'', '/teams/${team.id}/projects/${project.id}'); window.dispatchEvent(new PopStateEvent('popstate')); return true;`)
  await until(async () => (await evaluate(`return !!document.querySelector('.monaco-editor') && ([...document.querySelectorAll('.v2-workspace-status [aria-label]')].map(e=>e.getAttribute('aria-label')).join(' ')).includes('在线');`)), 'editor and ticket sync', 60000)
  await durable()
  console.log('PASS: authenticated project workspace, schema, ticket connection and initial durable state')
  await completion('/index.html', '<di', 3, 'div')
  await completion('/styles.css', 'body { col }', 10, 'color')
  await completion('/index.js', 'document.querySel', 17, 'querySelector')
  console.log('PASS: HTML/CSS/JS completion acceptance writes through Y.Text')
  await edit('/index.js', '/** @type {number} */\nlet count = "wrong";\nconsole.log(count);')
  await until(async () => (await markers('/index.js')).some(x => String(x.code) === '2322'), 'JS checkJs diagnostic', 30000)
  await edit('/styles.css', 'body { unknown-prop: 1; color: #12345; }')
  await until(async () => (await markers('/styles.css')).length >= 2, 'CSS property and value diagnostics')
  await durable()
  await edit('/index.html', '<div typo="x"><span></div>')
  await until(async () => (await markers('/index.html')).length >= 2, 'HTML tag and attribute diagnostics')
  console.log('PASS: HTML/CSS diagnostics and JS checkJs')
  await prompt('/helper.js'); await click('新建文件')
  await until(async () => evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts'); return !!${model('/helper.js')};`), 'new file model')
  await edit('/helper.js', '/** @param {number} value */\nexport function double(value) { return value * 2; }')
  await edit('/index.js', 'import { double } from "./helper.js";\nconsole.log(double("wrong"));')
  await until(async () => (await markers('/index.js')).some(x => String(x.code) === '2345'), 'relative import type diagnostic')
  await edit('/index.js', 'import { double } from "./helper.js";\nconsole.log(double(21));')
  await until(async () => (await markers('/index.js')).length === 0, 'fixed JS diagnostics')
  await prompt('/scripts/helper.js'); await click('重命名 /helper.js')
  await until(async () => evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts'); return !${model('/helper.js')} && !!${model('/scripts/helper.js')};`), 'rename model cleanup')
  await edit('/index.js', 'import { double } from "./scripts/helper.js";\nconsole.log(double(21));')
  await click('删除 /scripts/helper.js')
  await until(async () => evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts'); return !${model('/scripts/helper.js')};`), 'delete model cleanup')
  console.log('PASS: multi-file creation, relative imports, rename/delete model cleanup')
  await edit('/index.js', 'console.log("Step07 preview");')
  await edit('/styles.css', 'body { color: rgb(12, 34, 56); }')
  await edit('/index.html', '<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="/styles.css"></head><body><h1>Step07 Preview</h1><script type="module" src="/index.js"></script></body></html>')
  await durable()
  await evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts'); const e=m.editor.getEditors()[0], model=${model('/index.html')}; e.setModel(model); e.executeEdits('acceptance',[{range:new m.Range(1,1,1,1),text:'<!-- undo-marker -->'}]); e.trigger('acceptance','undo',null); return true;`)
  assert.equal(await evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts'); return ${model('/index.html')}.getValue().includes('undo-marker');`), false)
  await evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts'); m.editor.getEditors()[0].trigger('acceptance','redo',null); return true;`)
  assert.equal(await evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts'); return ${model('/index.html')}.getValue().includes('undo-marker');`), true)
  await durable()
  console.log('PASS: Y.Text undo/redo and generation confirmation')
  const beforeOversize = await evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts');return ${model('/index.js')}.getValue();`)
  await edit('/index.js', 'x'.repeat(1024 * 1024 + 1))
  assert.equal(await evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts');return ${model('/index.js')}.getValue();`), beforeOversize)
  await edit('/index.js', '// ' + 'x'.repeat(210 * 1024))
  assert.equal(await evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts');return ${model('/index.js')}.getLanguageId();`), 'budget-javascript')
  await durable(); await edit('/index.js', 'console.log("Step07 preview");'); await durable()
  console.log('PASS: oversized edit rejected before sync; large-file editing/highlight and automatic persistence')
  await click('Client')
  await until(async () => (await evaluate(`return document.querySelector('.v2-preview-pane')?.textContent||'';`)).includes('Step07 preview'), 'Sandpack runtime console', 90000)
  console.log('PASS: Sandpack build/preview runtime console')
  const pointer = await storage.describe(project.id), saved = loadDocument(await storage.load(pointer), { projectId: project.id, epoch: 1 })
  assert.ok(saved.getMap('files').get(saved.getMap('meta').get('entryFileId')).get('content').toString().includes('undo-marker'))
  assert.ok(![...saved.getMap('files').values()].some(f => f.get('path') === '/package.json'))
  saved.destroy()
  await gateway.stop(); gateway = createGateway(options); await gateway.server.listen()
  await until(async () => (await evaluate(`return ([...document.querySelectorAll('.v2-workspace-status [aria-label]')].map(e=>e.getAttribute('aria-label')).join(' '))||'';`)).includes('在线'), 'fresh-ticket reconnect')
  await durable()
  await evaluate(`history.pushState(null,'','/teams/${team.id}'); window.dispatchEvent(new PopStateEvent('popstate')); return true;`)
  await until(async () => evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts'); return m.editor.getModels().length===0 && m.editor.getEditors().length===0;`), 'workspace disposal')
  await evaluate(`history.pushState(null,'','/teams/${team.id}/projects/${project.id}');window.dispatchEvent(new PopStateEvent('popstate'));return true;`)
  await until(async () => evaluate(`return ([...document.querySelectorAll('.v2-workspace-status [aria-label]')].map(e=>e.getAttribute('aria-label')).join(' ')).includes('在线')||false;`), 'workspace remount')
  await completion('/index.js', 'document.querySel', 17, 'querySelector')
  await edit('/index.js', 'console.log("Step07 preview");'); await durable()
  await click('Client')
  await until(async () => (await evaluate(`return document.querySelector('.v2-preview-pane')?.textContent||'';`)).includes('Step07 preview'), 'remounted preview runtime', 90000)
  await cdp(`/screenshot?target=${target}&file=${encodeURIComponent(root + '/.codex-build/step07-workspace.png')}`)
  await api('/api/auth/logout', 'POST', {}, 200)
  await until(async () => evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts');const {getAuthUser}=await import('/src/api/auth.ts');return (([...document.querySelectorAll('.v2-workspace-status [aria-label]')].map(e=>e.getAttribute('aria-label')).join(' ')).includes('授权失效')||!getAuthUser())&&m.editor.getModels().length===0;`), 'authorization revocation clears models')
  console.log('PASS: server-side authorization revocation stops editing and clears models')
  console.log('PASS: MySQL/MinIO current files, gateway restart, new ticket and project cleanup')
  console.log(`Acceptance project ID: ${project.id}`)
} catch (error) {
  if (target) {
    console.log('Browser diagnostic summary:', await evaluate(`const {monaco:m}=await import('/src/editor/v2/languages.ts'); const el=document.querySelector('.v2-preview-pane');let f=el?.[Object.keys(el||{}).find(x=>x.startsWith('__reactFiber'))],runtime;while(f&&!runtime){for(let d=f.dependencies?.firstContext;d;d=d.next)if(d.memoizedValue?.files){const s=d.memoizedValue;runtime={status:s.status,error:s.error,clients:Object.values(s.clients).map(c=>({status:c.status})),files:Object.fromEntries(Object.entries(s.files).map(([p,v])=>[p,typeof v==='string'?v.slice(0,80):v.code.slice(0,80)]))};break;}f=f.return;}return {state:([...document.querySelectorAll('.v2-workspace-status [aria-label]')].map(e=>e.getAttribute('aria-label')).join(' ')),preview:el?.textContent,iframes:[...document.querySelectorAll('iframe')].map(x=>({src:x.src,width:x.clientWidth,height:x.clientHeight})),runtime,markers:m.editor.getModelMarkers({}).map(x=>({message:x.message,code:x.code}))};`).catch(() => 'unavailable'))
    await cdp(`/screenshot?target=${target}&file=${encodeURIComponent(root + '/.codex-build/step07-failure.png')}`).catch(() => {})
  }
  throw error
} finally {
  if (target) await cdp(`/close?target=${target}`).catch(() => {})
  await stop(vite)
  if (gateway) await gateway.stop()
  await stop(backend); await stop(initializer); closeSync(log); closeSync(viteLog)
}
