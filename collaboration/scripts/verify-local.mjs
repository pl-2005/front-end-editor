import { spawn } from 'node:child_process'
import { readFileSync, openSync, closeSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
const cwd = fileURLToPath(new URL('../../', import.meta.url))
const config = parseEnv(readFileSync(new URL('../../.env', import.meta.url), 'utf8'))
const env = { ...process.env, ...config, COLLAB_CREATION_ENABLED: 'true', COLLAB_INITIALIZER_PORT: '18091',
  COLLAB_INITIALIZER_URL: 'http://127.0.0.1:18091/internal/initialize',
  COLLAB_INITIALIZER_SECRET: randomBytes(32).toString('hex'), COLLAB_STORAGE_SECRET: randomBytes(32).toString('hex') }
const encoderEnv = {}
for (const key of ['SystemRoot', 'PATH', 'Path', 'TEMP', 'TMP', 'COLLAB_INITIALIZER_SECRET', 'COLLAB_INITIALIZER_PORT']) if (env[key]) encoderEnv[key] = env[key]
const initializer = spawn(process.execPath, [fileURLToPath(new URL('../dist/server.js', import.meta.url))], { env: encoderEnv, stdio: 'ignore', windowsHide: true })
let backend
const streams = []
/**
 * 启动使用仓库 .env 配置的本地后端，并将输出写入对应验收日志。
 *
 * @param suffix 本次启动的日志文件后缀
 */
function startBackend(suffix) {
  const output = openSync(`${cwd}/.codex-build/step05-local-${suffix}.log`, 'w'); streams.push(output)
  const child = spawn('java', ['-jar', `${cwd}/.codex-build/step05-backend/backend-0.1.0-SNAPSHOT.jar`, '--server.address=127.0.0.1', '--server.port=18085'], { cwd, env, stdio: ['ignore', output, output], windowsHide: true })
  child.on('error', () => {})
  return child
}
/**
 * 终止尚未退出的子进程并等待 exit 事件。
 *
 * @param child 待终止的子进程
 */
async function stop(child) {
  if (!child || child.exitCode !== null) return
  const exited = once(child, 'exit'); child.kill(); await exited
}
/**
 * 轮询本地健康接口直至可用，后端提前退出或超时则中止验收。
 */
async function ready() {
  for (let i = 0; i < 120; i++) {
    if (backend.exitCode !== null) throw new Error('Backend exited before readiness; inspect the local log')
    try { const response = await fetch('http://127.0.0.1:18085/api/health'); if (response.ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('Backend readiness timeout; inspect the local log')
}
/**
 * 启动本地验收脚本，recover 为 true 时验证重启恢复；非零退出码视为失败。
 *
 * @param recover 是否执行重启恢复验证
 */
async function acceptance(recover = false) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./acceptance.mjs', import.meta.url)), ...(recover ? ['--recover'] : [])], { cwd, env, stdio: 'inherit', windowsHide: true })
  const [code] = await once(child, 'exit')
  if (code !== 0) throw new Error('Local acceptance failed')
}
try {
  backend = startBackend('initial'); await ready(); await acceptance()
  await stop(backend)
  backend = startBackend('restart'); await ready(); await acceptance(true)
} finally {
  await stop(backend); await stop(initializer)
  for (const fd of streams) closeSync(fd)
}
