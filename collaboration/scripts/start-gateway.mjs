import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = new URL('../../.env', import.meta.url)
const allowed = ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'COLLAB_GATEWAY_ENABLED', 'COLLAB_GATEWAY_PORT',
  'COLLAB_SPRING_URL', 'COLLAB_STORAGE_SECRET', 'COLLAB_GATEWAY_SECRET', 'COLLAB_ALLOWED_ORIGINS', 'COLLAB_GATEWAY_NONCE_PATH',
  'COLLAB_MAX_ROOMS', 'COLLAB_MAX_CONNECTIONS', 'COLLAB_MAX_ROOM_CONNECTIONS', 'COLLAB_MAX_MEMORY_BYTES',
  'COLLAB_MAX_MESSAGES_PER_SECOND', 'COLLAB_MAX_BYTES_PER_SECOND', 'COLLAB_MAX_PENDING_BYTES', 'COLLAB_MAX_PENDING_UPDATES']
const config = parseEnv(readFileSync(root, 'utf8').split(/\r?\n/).filter(line => /^\s*(COLLAB_[A-Z_]+)\s*=/.test(line) && allowed.includes(line.match(/^\s*(COLLAB_[A-Z_]+)/)[1])).join('\n'))
const env = {}
for (const key of allowed) if (process.env[key] !== undefined || config[key] !== undefined) env[key] = process.env[key] ?? config[key]
const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/gateway-main.js', import.meta.url))],
  { cwd: fileURLToPath(new URL('../', import.meta.url)), env, stdio: 'inherit', windowsHide: true })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', code => { process.exitCode = code ?? 1 })
