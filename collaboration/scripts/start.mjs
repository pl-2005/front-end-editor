import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = new URL('../../.env', import.meta.url)
const allowed = ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'COLLAB_INITIALIZER_SECRET', 'COLLAB_INITIALIZER_PORT', 'COLLAB_INITIALIZER_NONCE_PATH']
for (const key of Object.keys(process.env)) if (!allowed.includes(key)) delete process.env[key]
const config = { ...parseEnv(readFileSync(root, 'utf8').split(/\r?\n/).filter(line => /^\s*COLLAB_INITIALIZER_(SECRET|PORT|NONCE_PATH)\s*=/.test(line)).join('\n')), ...process.env }
// Give the trusted encoder only its HMAC identity, never MySQL/MinIO/JWT credentials.
const env = {}
for (const key of allowed) {
  if (config[key] !== undefined) env[key] = config[key]
}
const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/server.js', import.meta.url))], { env, stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', code => { process.exitCode = code ?? 1 })
