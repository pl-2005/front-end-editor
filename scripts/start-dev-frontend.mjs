import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const port = Number(process.argv[2])
const vite = fileURLToPath(new URL('../frontend/node_modules/vite/bin/vite.js', import.meta.url))
if (process.argv.length !== 3 || !Number.isInteger(port) || port < 5173 || port > 65535) {
  console.error('前端端口必须是 5173 到 65535 之间的整数。')
  process.exitCode = 1
} else if (!existsSync(vite)) {
  console.error('未找到 Vite，请先在 frontend 目录执行 npm ci。')
  process.exitCode = 1
} else {
  // Ignore streams at the OS level: no console window, log file, or parent-owned pipe.
  const child = spawn(process.execPath, [vite, '--host', 'localhost', '--port', String(port), '--strictPort', '--open'], {
    cwd: fileURLToPath(new URL('../frontend/', import.meta.url)),
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  })
  child.once('error', () => {
    console.error('前端后台进程启动失败，请检查 Node.js 和前端依赖。')
    process.exitCode = 1
  })
  child.once('spawn', () => {
    console.log(`已启动后台前端（端口 ${port}），就绪后自动打开默认浏览器。`)
    child.unref()
  })
}
