import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync, mkdirSync, openSync, closeSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID } from 'node:crypto'
import { createGateway } from '../dist/gateway.js'
import { createAuthFetch } from './auth-cookie-client.mjs'

// Root .env owns service connections. Dedicated app ports and Redis namespace isolate this run.
const root = fileURLToPath(new URL('../../', import.meta.url))
const config = parseEnv(readFileSync(root + '.env', 'utf8'))
const base = 'http://127.0.0.1:18608', origin = 'http://127.0.0.1:15608'
const proxy = process.env.CDP_PROXY_URL ?? 'http://localhost:3456'
const run = randomUUID(), children = [], tabs = [], logs = []
const storageSecret = randomBytes(32).toString('hex'), gatewaySecret = randomBytes(32).toString('hex'), initializerSecret = randomBytes(32).toString('hex')
const env = { ...process.env, ...config, AUTH_COOKIE_SECURE: 'false', AUTH_LOCAL_DEVELOPMENT: 'true', AUTH_ALLOWED_ORIGINS: origin,
  AUTH_REDIS_NAMESPACE: (config.AUTH_REDIS_NAMESPACE ?? 'web-editor:auth') + ':session-acceptance:' + run,
  COLLAB_CREATION_ENABLED: 'true', COLLAB_TICKET_ENABLED: 'true', COLLAB_GATEWAY_ENABLED: 'true', COLLAB_MAINTENANCE_ENABLED: 'false',
  COLLAB_STORAGE_SECRET: storageSecret, COLLAB_GATEWAY_SECRET: gatewaySecret, COLLAB_INITIALIZER_SECRET: initializerSecret,
  COLLAB_GATEWAY_INTERNAL_URL: 'http://127.0.0.1:18609', COLLAB_INITIALIZER_URL: 'http://127.0.0.1:18610/internal/initialize' }
mkdirSync(root + '.codex-build', { recursive: true })
let gateway
function launch(command, args, environment, name) {
  const log = openSync(root + '.codex-build/auth-' + name + '.log', 'w'); logs.push(log)
  const child = spawn(command, args, { cwd: name === 'vite' ? root + 'frontend' : root, env: environment, windowsHide: true, stdio: ['ignore', log, log] })
  children.push(child); return child
}
async function until(predicate, label, timeout = 30_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 100)) }
  throw new Error('AUTH_ACCEPTANCE_TIMEOUT: ' + label)
}
const authFetch = createAuthFetch(origin)
async function api(path, body, expected = 200, token, method = 'POST') {
  const response = await authFetch(base + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) })
  assert.equal(response.status, expected, 'AUTH_API_STATUS ' + path)
  assert.equal(response.headers.get('Cache-Control'), path.startsWith('/api/auth/') ? 'no-store' : response.headers.get('Cache-Control'))
  return response.status === 204 ? undefined : (await response.json()).data
}
async function rawRefresh(cookie, expected = 200, headers = {}, body = '{}', endpoint = base) {
  const response = await fetch(endpoint + '/api/auth/refresh', { method: 'POST', headers: {
    Origin: origin, 'X-Web-Editor-Request': 'browser', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers,
  }, body, signal: AbortSignal.timeout(20_000) })
  assert.equal(response.status, expected, 'AUTH_REFRESH_STATUS')
  return response
}
async function loginRaw(name, password, endpoint = base) {
  const response = await fetch(endpoint + '/api/auth/login', { method: 'POST', headers: { Origin: origin, 'X-Web-Editor-Request': 'browser', 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: name, password }), signal: AbortSignal.timeout(20_000) })
  assert.equal(response.status, 200, 'AUTH_LOGIN_STATUS')
  const data = (await response.json()).data
  assert.ok(!('refreshToken' in data), 'AUTH_JSON_CREDENTIAL_BOUNDARY')
  const header = response.headers.get('Set-Cookie')
  assert.ok(header.includes('HttpOnly') && header.includes('SameSite=Strict') && header.includes('Path=/api/auth') && !header.includes('Domain='), 'AUTH_COOKIE_PROPERTIES')
  return { ...data, cookie: header.split(';')[0], age: Number(/Max-Age=(\d+)/.exec(header)[1]) }
}
async function rawLogout(cookie, expected = 200) {
  const response = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Origin: origin, 'X-Web-Editor-Request': 'browser', 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' })
  assert.equal(response.status, expected, 'AUTH_LOGOUT_STATUS')
  return (await response.json()).data.outcome
}
async function me(token, expected) {
  assert.equal((await fetch(base + '/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })).status, expected, 'AUTH_ME_STATUS')
}
async function cdp(path, body) {
  const response = await fetch(proxy + path, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(30_000) })
  const result = await response.json()
  if (!response.ok || result.error) throw new Error('AUTH_BROWSER_OPERATION_FAILED')
  return result
}
async function evaluate(tab, code) { return (await cdp('/eval?target=' + tab, `(async()=>{${code}})()`)).value }
async function newTab(url) { const tab = (await cdp('/new', url)).targetId; tabs.push(tab); return tab }
const pass = (name) => console.log('PASS ' + name)

try {
  launch(process.execPath, [root + 'collaboration/dist/server.js'], { ...env, COLLAB_INITIALIZER_PORT: '18610', COLLAB_INITIALIZER_NONCE_PATH: root + '.codex-build/auth-initializer.sqlite' }, 'initializer')
  const backend = launch('java', ['-jar', root + 'backend/target/backend-0.1.0-SNAPSHOT.jar', '--server.address=127.0.0.1', '--server.port=18608'], env, 'backend')
  await until(async () => { if (backend.exitCode !== null) throw new Error('AUTH_BACKEND_EXITED'); try { return (await fetch(base + '/api/health/readiness')).ok } catch { return false } }, 'local MySQL/MinIO/Redis readiness', 60_000)
  gateway = createGateway({ enabled: true, origins: [origin], port: 18609, address: '127.0.0.1', springUrl: base, storageSecret, gatewaySecret,
    noncePath: root + '.codex-build/auth-gateway.sqlite', maxRooms: 10, maxConnections: 30, maxRoomConnections: 10,
    maxMemoryBytes: 512 * 1024 * 1024, maxMessagesPerSecond: 100, maxBytesPerSecond: 4 * 1024 * 1024 })
  await gateway.server.listen()
  launch(process.execPath, [root + 'frontend/node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '15608', '--strictPort'], { ...env, LOCAL_API_URL: base, LOCAL_COLLAB_URL: 'ws://127.0.0.1:18609' }, 'vite')
  await until(async () => { try { return (await fetch(origin)).ok } catch { return false } }, 'vite')
  const name = 'auth_' + randomBytes(6).toString('hex'), password = randomBytes(24).toString('hex')
  await api('/api/auth/register', { username: name, password }, 201)
  const owner = await api('/api/auth/login', { login: name, password })
  const team = await api('/api/teams', { name: 'Browser session acceptance' }, 201, owner.accessToken)
  const project = await api(`/api/teams/${team.id}/projects`, { name: 'Restored project', template: 'vanilla', entry: '/index.html' }, 201, owner.accessToken)

  const first = await loginRaw(name, password)
  for (const headers of [{ Origin: 'null' }, { Origin: 'https://evil.example' }, { Origin: 'http://sibling.localhost:15608' }, { 'X-Web-Editor-Request': '' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const denied = await rawRefresh(first.cookie, 403, headers); assert.ok(!denied.headers.has('Set-Cookie'), 'AUTH_CSRF_NO_COOKIE')
  }
  await rawRefresh(first.cookie, 400, {}, '{"refreshToken":"removed-contract"}')
  await rawRefresh(first.cookie + '; ' + first.cookie, 401)
  const rotated = await rawRefresh(first.cookie)
  const current = rotated.headers.get('Set-Cookie').split(';')[0]
  assert.ok(current !== first.cookie, 'AUTH_COOKIE_ROTATED')
  assert.ok(!('refreshToken' in (await rotated.json()).data), 'AUTH_REFRESH_JSON_BOUNDARY')
  await rawRefresh(first.cookie, 401)
  await rawRefresh(current, 401)
  pass('Cookie contract, CSRF rejection without rotation, duplicate cookies, strict replay revokes family')

  const stale = await loginRaw(name, password), active = await loginRaw(name, password)
  assert.equal(await rawLogout(active.cookie), 'revoked')
  await me(stale.accessToken, 401)
  const fresh = await loginRaw(name, password)
  assert.equal(await rawLogout(stale.cookie), 'local-only')
  await me(fresh.accessToken, 200)
  pass('Cookie-only logout commits all-session revocation; stale versions cannot revoke newly logged-in sessions')

  // Different browser families contend on the MySQL user row, independent of Web Locks.
  const browserA = await loginRaw(name, password), browserB = await loginRaw(name, password)
  await Promise.all([rawLogout(browserA.cookie), rawRefresh(browserB.cookie, 200).catch(async (error) => {
    // The revoke may win. In that ordering refresh must return 401 and not issue a cookie.
    const response = await rawRefresh(browserB.cookie, 401); assert.ok(response.headers.get('Set-Cookie')?.includes('Max-Age=0'))
    if (error.code !== 'ERR_ASSERTION') throw error
  })])
  await me(browserA.accessToken, 401); await me(browserB.accessToken, 401)
  pass('Concurrent cross-browser refresh and logout respect user version revocation')

  const lifetimeBase = 'http://127.0.0.1:18611'
  const lifetime = launch('java', ['-jar', root + 'backend/target/backend-0.1.0-SNAPSHOT.jar', '--server.address=127.0.0.1', '--server.port=18611'],
    { ...env, AUTH_REDIS_NAMESPACE: env.AUTH_REDIS_NAMESPACE + ':lifetimes', AUTH_REFRESH_IDLE_TIMEOUT: '3s', AUTH_REFRESH_MAX_LIFETIME: '8s', COLLAB_GATEWAY_ENABLED: 'false' }, 'lifetimes')
  await until(async () => { if (lifetime.exitCode !== null) throw new Error('AUTH_LIFETIME_BACKEND_EXITED'); try { return (await fetch(lifetimeBase + '/api/health')).ok } catch { return false } }, 'lifetime server', 60_000)
  const evicted = await loginRaw(name, password, lifetimeBase)
  for (let i = 0; i < 5; i++) await loginRaw(name, password, lifetimeBase)
  await rawRefresh(evicted.cookie, 401, {}, '{}', lifetimeBase)
  const idleSession = await loginRaw(name, password, lifetimeBase)
  await new Promise(resolve => setTimeout(resolve, 3200))
  await rawRefresh(idleSession.cookie, 401, {}, '{}', lifetimeBase)
  const absoluteSession = await loginRaw(name, password, lifetimeBase), startedLifetime = Date.now()
  let absoluteCookie = absoluteSession.cookie
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    const response = await rawRefresh(absoluteCookie, 200, {}, '{}', lifetimeBase)
    const header = response.headers.get('Set-Cookie'), age = Number(/Max-Age=(\d+)/.exec(header)[1])
    assert.ok(age <= Math.floor(Math.min(3000, 8000 - (Date.now() - startedLifetime) + 100) / 1000), 'AUTH_COOKIE_MAX_AGE_BOUND')
    absoluteCookie = header.split(';')[0]
  }
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 8200 - (Date.now() - startedLifetime))))
  await rawRefresh(absoluteCookie, 401, {}, '{}', lifetimeBase)
  lifetime.kill()
  pass('Real Redis family eviction, idle expiration, absolute lifetime and Cookie Max-Age bound (accelerated 3s/8s configuration)')

  const tab1 = await newTab(origin + '/login')
  await until(async () => evaluate(tab1, "return !!document.querySelector('input[name=login]');"), 'login page')
  await evaluate(tab1, `document.querySelector('input[name=login]').value=${JSON.stringify(name)};document.querySelector('input[name=password]').value=${JSON.stringify(password)};document.querySelector('form').requestSubmit();return true;`)
  await until(async () => evaluate(tab1, "return location.pathname==='/teams';"), 'UI login')
  const route = `/teams/${team.id}/projects/${project.id}?restore=1#code`
  await cdp('/navigate?target=' + tab1, origin + route)
  await until(async () => evaluate(tab1, "return ([...document.querySelectorAll('.v2-workspace-status [aria-label]')].map(e=>e.getAttribute('aria-label')).join(' ')).includes('在线');"), 'project restore and new ticket', 60_000)
  const tab2 = await newTab(origin + route)
  await until(async () => evaluate(tab2, "return ([...document.querySelectorAll('.v2-workspace-status [aria-label]')].map(e=>e.getAttribute('aria-label')).join(' ')).includes('在线');"), 'new tab restore', 60_000)
  await Promise.all([cdp('/navigate?target=' + tab1, origin + route), cdp('/navigate?target=' + tab2, origin + route)])
  for (const tab of [tab1, tab2]) {
    await until(async () => evaluate(tab, "return ([...document.querySelectorAll('.v2-workspace-status [aria-label]')].map(e=>e.getAttribute('aria-label')).join(' ')).includes('在线');"), 'simultaneous project restore', 60_000)
    assert.equal(await evaluate(tab, "return location.pathname+location.search+location.hash;"), route)
    assert.equal(await evaluate(tab, "return !document.cookie.includes('web_editor_refresh') && !JSON.stringify(localStorage).includes('accessToken') && !JSON.stringify(sessionStorage).includes('accessToken');"), true)
  }
  pass('Real Chrome project reload, same-browser new tab, simultaneous reloads, route/query/hash and HttpOnly boundary')

  const before = await evaluate(tab1, "const a=await import('/src/api/auth.ts');return a.getAuthSession();")
  await evaluate(tab1, "window.__authFetch=window.fetch;window.fetch=(url,init)=>String(url).endsWith('/api/auth/refresh')?Promise.resolve(new Response(JSON.stringify({code:'AUTH_SERVICE_UNAVAILABLE'}),{status:503})):window.__authFetch(url,init);const a=await import('/src/api/auth.ts');try{await a.refreshCredentials()}catch{}return true;")
  assert.equal(await evaluate(tab1, "const a=await import('/src/api/auth.ts');return !!a.getAuthUser()&&a.getAuthStatus()==='authenticated'&&!!document.querySelector('.monaco-editor');"), true)
  assert.equal(await evaluate(tab1, "const a=await import('/src/api/auth.ts');return a.getAuthSession();"), before)
  await evaluate(tab1, "window.fetch=window.__authFetch;const a=await import('/src/api/auth.ts');await a.refreshCredentials(true);return true;")
  pass('Runtime refresh 503 preserves mounted workspace, identity and session generation; manual recovery succeeds')

  await evaluate(tab1, "let node=document.querySelector('.v2-workspace');let fiber=node?.[Object.keys(node).find(k=>k.startsWith('__reactFiber'))];while(fiber&&!fiber.memoizedProps?.session)fiber=fiber.return;window.__authSession=fiber?.memoizedProps.session;if(!window.__authSession)throw new Error('Session missing');window.__authFetch=window.fetch;window.fetch=(url,init)=>String(url).includes('/collab-ticket')||String(url).endsWith('/api/auth/refresh')?Promise.resolve(new Response(JSON.stringify({code:'AUTH_SERVICE_UNAVAILABLE'}),{status:503})):window.__authFetch(url,init);window.__authSession.websocket.disconnect();return true;")
  await until(async () => evaluate(tab1, "return window.__authSession.state.connection==='offline';"), 'offline session')
  await evaluate(tab1, "window.__authSession.mutate(doc=>{const file=[...doc.getMap('files').values()].find(f=>f.get('path')==='/index.js');const text=file.get('content');text.insert(text.length,'\\n// auth session offline acceptance');});return true;")
  await until(async () => evaluate(tab1, "return window.__authSession.state.pendingBytes>0 && window.__authSession.state.local==='saved';"), 'offline IndexedDB write')
  const queued = await evaluate(tab1, "const s=window.__authSession;return {pending:s.state.pendingBytes,names:(await indexedDB.databases()).map(d=>d.name).filter(n=>n?.startsWith('web-editor:'))};")
  await evaluate(tab1, "const a=await import('/src/api/auth.ts');try{await a.refreshCredentials()}catch{}return true;")
  assert.equal(await evaluate(tab1, "return window.__authSession.state.pendingBytes;"), queued.pending)
  assert.equal(await evaluate(tab1, "return window.__authSession.state.connection!=='forbidden' && !!document.querySelector('.monaco-editor');"), true)
  assert.deepEqual(await evaluate(tab1, "return (await indexedDB.databases()).map(d=>d.name).filter(n=>n?.startsWith('web-editor:'));"), queued.names)
  await evaluate(tab1, "window.fetch=window.__authFetch;const a=await import('/src/api/auth.ts');await a.refreshCredentials(true);await window.__authSession.connect();return true;")
  await until(async () => evaluate(tab1, "return window.__authSession.state.connection==='online' && window.__authSession.state.pendingBytes===0;"), 'offline replay after auth recovery', 60_000)
  pass('Real IndexedDB offline queue survives refresh 503 without forbid and replays after recovery')

  const holder = await newTab(origin + '/teams')
  await until(async () => evaluate(holder, "const a=await import('/src/api/auth.ts');return !!a.getAuthUser();"), 'lock holder authenticated')
  await evaluate(holder, "void navigator.locks.request('web-editor-auth-session',async()=>{window.__authLockHeld=true;await new Promise(()=>{});});return true;")
  await until(async () => evaluate(holder, "return !!window.__authLockHeld;"), 'lock acquired')
  await evaluate(tab2, "const a=await import('/src/api/auth.ts');window.__authLockFinished=false;void a.refreshCredentials().then(()=>{window.__authLockFinished=true});return true;")
  await cdp('/close?target=' + holder); tabs.splice(tabs.indexOf(holder), 1)
  await until(async () => evaluate(tab2, "return window.__authLockFinished;"), 'lock released by closed holder')
  pass('Closing the lock holder releases the browser lock and a waiting refresh completes safely')

  // Password obtains a fresh token within the existing lock, then clears both tabs.
  const replacement = randomBytes(24).toString('hex')
  await evaluate(tab1, `const a=await import('/src/api/auth.ts');a.setCredentials({user:a.getAuthUser(),accessToken:a.getAccessToken(),expiresIn:0},true);await a.changePassword(${JSON.stringify(password)},${JSON.stringify(replacement)});return true;`)
  for (const tab of [tab1, tab2]) await until(async () => evaluate(tab, "const a=await import('/src/api/auth.ts');return !a.getAuthUser();"), 'multi-tab password revocation')
  pass('Expired-token password change completes without nested locks and clears all same-browser tabs')

  await evaluate(tab1, `const a=await import('/src/api/auth.ts');await a.login(${JSON.stringify(name)},${JSON.stringify(replacement)});return true;`)
  await cdp('/navigate?target=' + tab2, origin + '/teams')
  await until(async () => evaluate(tab2, "const a=await import('/src/api/auth.ts');return !!a.getAuthUser();"), 'second tab before logout')
  await evaluate(tab1, "window.__authFetch=window.fetch;window.fetch=(url,init)=>String(url).endsWith('/api/auth/logout')?Promise.reject(new TypeError('offline')):window.__authFetch(url,init);const a=await import('/src/api/auth.ts');try{await a.logout()}catch{}return a.getAuthStatus();")
  await cdp('/navigate?target=' + tab1, origin + '/teams')
  for (const tab of [tab1, tab2]) await until(async () => evaluate(tab, "const a=await import('/src/api/auth.ts');return a.getAuthStatus()==='logout-pending'&&!a.getAuthUser();"), 'persistent logout pending')
  await evaluate(tab1, "const a=await import('/src/api/auth.ts');const result=await a.logout();if(result.outcome!=='revoked')throw new Error('Expected confirmed revoke');return true;")
  pass('Failed logout blocks auto-restore across tabs and reload; explicit retry confirms committed revocation')
  console.log('AUTH_BROWSER', await evaluate(tab1, 'return navigator.userAgent;'))
  console.log('AUTH_SESSION_LOCAL_ACCEPTANCE_PASSED')
} catch (error) {
  console.error('AUTH_SESSION_LOCAL_ACCEPTANCE_FAILED ' + (error.message ?? error.code ?? 'unknown'))
  for (const tab of tabs) console.log('AUTH_BROWSER_DIAGNOSTIC', await evaluate(tab,
    "const a=await import('/src/api/auth.ts');return {path:location.pathname,status:a.getAuthStatus(),error:a.getAuthError(),workspace:([...document.querySelectorAll('.v2-workspace-status [aria-label]')].map(e=>e.getAttribute('aria-label')).join(' ')),alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent),headings:[...document.querySelectorAll('h1,h2')].map(e=>e.textContent)};").catch(() => ({ unavailable: true })))
  process.exitCode = 1
} finally {
  for (const tab of tabs) await cdp('/close?target=' + tab).catch(() => {})
  if (gateway) await gateway.stop()
  for (const child of children.reverse()) if (child.exitCode === null) child.kill()
  for (const log of logs) closeSync(log)
}
