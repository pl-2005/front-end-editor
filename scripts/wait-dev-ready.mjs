import { readFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { parseEnv } from 'node:util'
import { pathToFileURL } from 'node:url'

function listening(url, timeoutMs) {
  return new Promise(resolve => {
    const socket = createConnection({
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: Number(url.port || (['https:', 'wss:'].includes(url.protocol) ? 443 : 80)),
    })
    const finish = ready => { socket.destroy(); resolve(ready) }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
  })
}

export async function waitForServices(config, {
  timeoutMs = 180_000,
  intervalMs = 500,
  requestTimeoutMs = 1500,
  onWaiting = () => {},
} = {}) {
  let api, initializer, gateway
  try {
    api = new URL(`${(config.LOCAL_API_URL || 'http://localhost:8080').replace(/\/$/, '')}/api/health/readiness`)
    initializer = new URL(config.COLLAB_INITIALIZER_URL || 'http://127.0.0.1:8091/internal/initialize')
    gateway = new URL(config.LOCAL_COLLAB_URL || `ws://127.0.0.1:${config.COLLAB_GATEWAY_PORT || 8092}`)
  } catch {
    throw new Error('本地服务地址配置无效，请检查根目录 .env。')
  }
  const checks = [
    { name: '后端 API', ready: async timeout => {
      try {
        const response = await fetch(api, { signal: AbortSignal.timeout(timeout), redirect: 'error' })
        if (response.status !== 200) { await response.body?.cancel(); return false }
        return (await response.json()).data?.status === 'UP'
      } catch { return false }
    } },
    { name: '协作初始化服务', ready: timeout => listening(initializer, timeout) },
    { name: '协作网关', ready: timeout => listening(gateway, timeout) },
  ]
  const deadline = Date.now() + timeoutMs
  let pending = checks.map(check => check.name)
  let lastMessage = ''
  while (Date.now() < deadline) {
    const timeout = Math.max(1, Math.min(requestTimeoutMs, deadline - Date.now()))
    const results = await Promise.allSettled(checks.map(check => check.ready(timeout)))
    pending = checks.filter((_, index) => results[index].status !== 'fulfilled' || !results[index].value).map(check => check.name)
    if (pending.length === 0) return
    const message = pending.join('、')
    if (message !== lastMessage) { onWaiting(pending); lastMessage = message }
    await delay(Math.max(0, Math.min(intervalMs, deadline - Date.now())))
  }
  throw new Error(`等待服务就绪超时：${pending.join('、')}。请查看对应 PowerShell 窗口中的错误信息；本次未打开浏览器。`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const seconds = Number(process.argv[2] ?? 180)
    if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 1800) throw new Error('启动等待时间必须为 1 到 1800 秒。')
    let config
    try { config = parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8')) }
    catch { throw new Error('无法读取仓库根目录的 .env 配置文件。') }
    console.log(`正在等待后台服务就绪（最多 ${seconds} 秒）……`)
    await waitForServices(config, {
      timeoutMs: seconds * 1000,
      onWaiting: pending => console.log(`尚未就绪：${pending.join('、')}`),
    })
    console.log('后端 API、协作初始化服务和网关均已就绪，即将启动前端并打开浏览器。')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
