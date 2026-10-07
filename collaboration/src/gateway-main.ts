import { createGateway } from './gateway.js'

const number = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${name}`)
  return value
}
const gateway = createGateway({
  enabled: process.env.COLLAB_GATEWAY_ENABLED === 'true', origins: (process.env.COLLAB_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
  port: number('COLLAB_GATEWAY_PORT', 8092), address: '127.0.0.1', springUrl: process.env.COLLAB_SPRING_URL ?? 'http://127.0.0.1:8080',
  storageSecret: process.env.COLLAB_STORAGE_SECRET ?? '', gatewaySecret: process.env.COLLAB_GATEWAY_SECRET ?? '',
  noncePath: process.env.COLLAB_GATEWAY_NONCE_PATH ?? '../.codex-build/gateway-nonces.sqlite',
  maxRooms: number('COLLAB_MAX_ROOMS', 50), maxConnections: number('COLLAB_MAX_CONNECTIONS', 200),
  maxRoomConnections: number('COLLAB_MAX_ROOM_CONNECTIONS', 20), maxMemoryBytes: number('COLLAB_MAX_MEMORY_BYTES', 512 * 1024 * 1024),
  maxMessagesPerSecond: number('COLLAB_MAX_MESSAGES_PER_SECOND', 100), maxBytesPerSecond: number('COLLAB_MAX_BYTES_PER_SECOND', 4 * 1024 * 1024),
  maxPendingBytes: number('COLLAB_MAX_PENDING_BYTES', 24 * 1024 * 1024), maxPendingUpdates: number('COLLAB_MAX_PENDING_UPDATES', 10000),
})
await gateway.server.listen()
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  const shutdown = () => void gateway.stop().then(() => { process.exitCode = 0 }).catch(() => {
    // Preserve failed rooms and retry shutdown; never exit with undurable work during normal shutdown.
    console.error('COLLAB_SHUTDOWN_FLUSH_FAILED'); setTimeout(shutdown, 1000)
  })
  shutdown()
})
