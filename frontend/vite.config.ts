import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('../', import.meta.url)), '')
  return {
    plugins: [react()],
    cacheDir: env.LOCAL_VITE_CACHE_DIR || 'node_modules/.vite',
    resolve: { dedupe: ['yjs', 'monaco-editor'] },
    worker: { format: 'es' },
    server: {
      port: 5173,
      proxy: {
        '/api': env.LOCAL_API_URL || 'http://localhost:8080',
        '^/collaboration$': {
          target: env.LOCAL_COLLAB_URL || `ws://127.0.0.1:${env.COLLAB_GATEWAY_PORT || 8092}`,
          ws: true,
          rewriteWsOrigin: false,
        },
      },
    },
  }
})
