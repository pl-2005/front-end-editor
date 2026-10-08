import { readFileSync, mkdirSync, openSync, closeSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createGateway } from '../dist/gateway.js'
import { releaseEdge } from './release-edge.mjs'

// Read the repository root .env, never print it, and keep credentials out of public assets.
const root = fileURLToPath(new URL('../../', import.meta.url)), collab = fileURLToPath(new URL('../', import.meta.url))
const config = parseEnv(readFileSync(root + '/.env', 'utf8'))
const base = 'http://127.0.0.1:18098', origin = 'http://127.0.0.1:15175'
const children = [], descriptors = []
let gateway, edge, shuttingDown = false
const systemEnv = {}
for (const key of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP']) if (process.env[key]) systemEnv[key] = process.env[key]
async function until(predicate) {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error('LOCAL_START_TIMEOUT')
}
function child(command, args, env, label) {
  const log = openSync(root + '/.codex-build/step11-running-' + label + '.log', 'a'); descriptors.push(log)
  const process = spawn(command, args, { cwd: root, env, stdio: ['ignore', log, log], windowsHide: true })
  children.push(process)
  process.on('error', () => { console.error('LOCAL_CHILD_START_FAILED'); void shutdown(1) })
  process.on('exit', () => { if (!shuttingDown) { console.error('LOCAL_CHILD_EXITED'); void shutdown(1) } })
  return process
}
async function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  try {
    // Flush failure keeps API/encoder alive and retries; never discard pending on normal stop.
    if (gateway) await gateway.stop()
  } catch {
    console.error('LOCAL_SHUTDOWN_FLUSH_FAILED'); shuttingDown = false; setTimeout(() => void shutdown(code), 1000); return
  }
  if (edge) { edge.closeAllConnections(); await new Promise(resolve => edge.close(resolve)) }
  for (const process of children) if (process.exitCode === null && process.pid) { const exited = once(process, 'exit'); process.kill(); await exited }
  for (const log of descriptors) closeSync(log)
  process.exitCode = code
}
try {
  for (const key of ['JWT_SECRET', 'COLLAB_STORAGE_SECRET', 'COLLAB_GATEWAY_SECRET', 'COLLAB_INITIALIZER_SECRET']) {
    if (Buffer.byteLength(config[key] ?? '') < 32) throw new Error('LOCAL_SECRET_CONFIG_REQUIRED')
  }
  mkdirSync(root + '/.codex-build', { recursive: true })
  child(process.execPath, [collab + '/dist/server.js'], { ...systemEnv, COLLAB_INITIALIZER_SECRET: config.COLLAB_INITIALIZER_SECRET,
    COLLAB_INITIALIZER_PORT: '18100', COLLAB_INITIALIZER_NONCE_PATH: root + '/.codex-build/local-initializer-nonces.sqlite' }, 'initializer')
  const backend = child('java', ['-jar', root + '/.codex-build/step11-backend/backend-0.1.0-SNAPSHOT.jar', '--server.address=127.0.0.1', '--server.port=18098'],
    { ...systemEnv, ...config, AUTH_COOKIE_SECURE: 'false', AUTH_LOCAL_DEVELOPMENT: 'true', AUTH_ALLOWED_ORIGINS: origin + ',http://localhost:15175', COLLAB_CREATION_ENABLED: 'true', COLLAB_TICKET_ENABLED: 'true', COLLAB_GATEWAY_ENABLED: 'true', COLLAB_MAINTENANCE_ENABLED: 'false',
      COLLAB_INITIALIZER_URL: 'http://127.0.0.1:18100/internal/initialize', COLLAB_GATEWAY_INTERNAL_URL: 'http://127.0.0.1:18099' }, 'backend')
  await until(async () => { if (backend.exitCode !== null) throw new Error('LOCAL_BACKEND_EXITED'); try { return (await fetch(base + '/api/health/readiness')).ok } catch { return false } })
  const positive = (key, fallback) => { const n = Number(config[key] ?? fallback); if (!Number.isSafeInteger(n) || n <= 0) throw new Error('LOCAL_LIMIT_INVALID'); return n }
  gateway = createGateway({ enabled: true, origins: [origin, 'http://localhost:15175'], port: 18099, address: '127.0.0.1', springUrl: base,
    storageSecret: config.COLLAB_STORAGE_SECRET, gatewaySecret: config.COLLAB_GATEWAY_SECRET, noncePath: root + '/.codex-build/local-gateway-nonces.sqlite',
    maxRooms: positive('COLLAB_MAX_ROOMS', 50), maxConnections: positive('COLLAB_MAX_CONNECTIONS', 200), maxRoomConnections: positive('COLLAB_MAX_ROOM_CONNECTIONS', 20),
    maxMemoryBytes: positive('COLLAB_MAX_MEMORY_BYTES', 512 * 1024 * 1024), maxMessagesPerSecond: positive('COLLAB_MAX_MESSAGES_PER_SECOND', 100),
    maxBytesPerSecond: positive('COLLAB_MAX_BYTES_PER_SECOND', 4 * 1024 * 1024), maxPendingBytes: positive('COLLAB_MAX_PENDING_BYTES', 24 * 1024 * 1024),
    maxPendingUpdates: positive('COLLAB_MAX_PENDING_UPDATES', 10000) })
  await gateway.server.listen()
  edge = releaseEdge({ directory: root + '/.codex-build/step11-frontend', apiPort: 18098, gatewayPort: 18099 })
  await new Promise((resolve, reject) => { edge.once('error', reject); edge.listen(15175, '127.0.0.1', resolve) })
  console.log('LOCAL_V2_READY ' + origin)
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void shutdown())
} catch { console.error('LOCAL_START_FAILED: check restricted .codex-build logs/configuration'); await shutdown(1) }
