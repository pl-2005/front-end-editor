import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { requestCookies, responseCookies } from './dev/authCookies.ts'

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('../', import.meta.url)), '')
  const cacheRoot = env.LOCAL_VITE_CACHE_DIR || 'node_modules/.vite'
  return {
    plugins: [react()],
    // 开发进程各用独立缓存，避免多实例同时优化依赖时互相覆盖。
    cacheDir: command === 'serve' ? `${cacheRoot}/instances/${process.pid}` : cacheRoot,
    // 启动时预先优化 HTML 语言服务，避免进入协作编辑器后才发现依赖并刷新页面。
    optimizeDeps: { include: ['vscode-html-languageservice'] },
    resolve: { dedupe: ['yjs', 'monaco-editor'] },
    worker: { format: 'es' },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: env.LOCAL_API_URL || 'http://localhost:8080',
          configure(proxy) {
            proxy.on('proxyReq', (upstream, request) => {
              const cookie = requestCookies(request.headers.cookie, request.socket.localPort!)
              if (cookie) upstream.setHeader('Cookie', cookie)
              else upstream.removeHeader('Cookie')
            })
            proxy.on('proxyRes', (upstream, request) => {
              const cookies = responseCookies(
                upstream.headers['set-cookie'],
                request.socket.localPort!,
              )
              if (cookies) upstream.headers['set-cookie'] = cookies
            })
          },
        },
        '^/collaboration$': {
          target: env.LOCAL_COLLAB_URL || `ws://127.0.0.1:${env.COLLAB_GATEWAY_PORT || 8092}`,
          ws: true,
          rewriteWsOrigin: false,
        },
      },
    },
  }
})
