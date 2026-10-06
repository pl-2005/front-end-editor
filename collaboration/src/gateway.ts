import { Server, type Connection } from '@hocuspocus/server'
import * as decoding from 'lib0/decoding'
import { performance } from 'node:perf_hooks'
import { removeAwarenessStates } from 'y-protocols/awareness'
import { LIMITS, loadDocument } from './document.js'
import { SpringApi, NonceStore, authenticateInternal, InternalFailure, type Identity, type Authorization } from './internal.js'
import { Room } from './room.js'

type Context = { identity: Identity; authorization: Authorization; expires: number; closed: boolean; key: string;
  rateStart: number; messages: number; bytes: number; leaseTimer?: NodeJS.Timeout; renewTimer?: NodeJS.Timeout; awarenessId?: number }
export type GatewayOptions = {
  enabled: boolean; origins: string[]; port: number; address: string; springUrl: string; storageSecret: string;
  gatewaySecret: string; noncePath: string; maxRooms: number; maxConnections: number; maxRoomConnections: number;
  maxMemoryBytes: number; maxMessagesPerSecond: number; maxBytesPerSecond: number
}
export function parseRoom(name: string): { projectId: number; epoch: number } {
  const match = /^project:([1-9]\d*):epoch:([1-9]\d*)$/.exec(name)
  if (!match || !Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[2]))) throw new InternalFailure('COLLAB_ROOM_INVALID', 400)
  return { projectId: Number(match[1]), epoch: Number(match[2]) }
}
/** Presence positions use y-monaco's relative anchor/head format, not arbitrary client objects. */
function validSelection(value: unknown): boolean {
  if (value === null) return true
  if (typeof value !== 'object' || !value || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !['anchor', 'head'].includes(key))) return false
  const position = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const item = value as Record<string, unknown>
    if (Object.keys(item).some(key => !['type', 'tname', 'item', 'assoc'].includes(key))) return false
    const id = (value: unknown) => {
      if (value === null || value === undefined) return true
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false
      const id = value as Record<string, unknown>
      return Object.keys(id).every(key => ['client', 'clock'].includes(key))
        && Number.isSafeInteger(id.client) && Number(id.client) >= 0 && Number.isSafeInteger(id.clock) && Number(id.clock) >= 0
    }
    return id(item.type) && id(item.item) && (item.tname === undefined || item.tname === null || typeof item.tname === 'string' && item.tname.length <= 100)
      && (item.assoc === undefined || Number.isSafeInteger(item.assoc))
  }
  return position(record.anchor) && position(record.head)
}

export function createGateway(options: GatewayOptions) {
  const api = new SpringApi(options.springUrl, options.storageSecret), nonces = new NonceStore(options.noncePath)
  if (Buffer.byteLength(options.gatewaySecret) < 32 || options.gatewaySecret === options.storageSecret) throw new InternalFailure('COLLAB_INTERNAL_UNCONFIGURED')
  const rooms = new Map<string, Room>(), claims = new Map<string, string>(), awarenessOwners = new Map<string, Map<number, string>>()
  let loading = 0, stopping = false
  let stopPromise: Promise<void> | undefined
  const sockets = new Set<import('node:stream').Duplex>()
  const requireOrigin = (origin: string | null | undefined) => {
    if (!options.enabled || stopping || !origin || !options.origins.includes(origin)) throw new InternalFailure('COLLAB_ORIGIN_DENIED', 403)
  }
  const writable = (context: Context) => {
    if (!context || context.closed || performance.now() >= context.expires || stopping) throw new InternalFailure('COLLAB_AUTHORIZATION_EXPIRED', 403)
  }
  const armLease = (context: Context, connection: Connection<Context>) => {
    clearTimeout(context.leaseTimer); clearTimeout(context.renewTimer)
    const close = () => {
      context.closed = true; clearTimeout(context.renewTimer)
      connection.readOnly = true; connection.close({ code: 4403, reason: 'COLLAB_AUTHORIZATION_EXPIRED' })
    }
    context.leaseTimer = setTimeout(close, Math.max(0, context.expires - performance.now()))
    context.renewTimer = setTimeout(async () => {
      const started = performance.now()
      try {
        await api.revalidate(context.authorization)
        if (context.closed || performance.now() >= context.expires || started + 5000 <= performance.now()) { close(); return }
        context.expires = started + 5000; armLease(context, connection)
      } catch { close() }
    }, Math.max(0, context.expires - performance.now() - 1500))
  }
  const server = new Server<Context>({
    port: options.port, address: options.address, quiet: true, stopOnSignals: false,
    websocketOptions: { maxPayload: LIMITS.updateBytes + 1024, perMessageDeflate: false },
    debounce: 1000, maxDebounce: 5000,
    async onUpgrade({ request, socket }) {
      try {
        requireOrigin(request.headers.origin)
        if (request.url !== '/collaboration' || sockets.size >= options.maxConnections || process.memoryUsage().rss >= options.maxMemoryBytes)
          throw new InternalFailure('COLLAB_CONNECTION_LIMIT', 503)
        sockets.add(socket); socket.once('close', () => sockets.delete(socket))
        let started = performance.now(), bytes = 0
        socket.on('data', (chunk: Buffer) => {
          if (performance.now() - started >= 1000) { started = performance.now(); bytes = 0 }
          bytes += chunk.length
          if (bytes > options.maxBytesPerSecond + 4096 || process.memoryUsage().rss >= options.maxMemoryBytes) socket.destroy()
        })
      } catch {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
        throw null // Hocuspocus onUpgrade uses an empty rejection to suppress its default upgrade.
      }
    },
    async onConnect({ requestHeaders, documentName, requestParameters }) {
      requireOrigin(requestHeaders.get('origin')); parseRoom(documentName)
      if (requestParameters.size) throw new InternalFailure('COLLAB_QUERY_DENIED', 403)
    },
    async onAuthenticate({ token, documentName, socketId, requestHeaders }) {
      requireOrigin(requestHeaders.get('origin'))
      const target = parseRoom(documentName), key = `${socketId}/${documentName}`
      if (claims.size >= options.maxConnections || [...claims.values()].filter(name => name === documentName).length >= options.maxRoomConnections)
        throw new InternalFailure('COLLAB_CONNECTION_LIMIT', 503)
      claims.set(key, documentName)
      const started = performance.now()
      try {
        const { identity, authorization } = await api.consume(token, target.projectId, target.epoch)
        if (identity.projectId !== target.projectId || identity.epoch !== target.epoch || authorization.userId !== identity.userId
          || authorization.projectId !== target.projectId || authorization.epoch !== target.epoch || performance.now() >= started + 5000)
          throw new InternalFailure('COLLAB_TICKET_INVALID', 401)
        return { identity, authorization, expires: started + 5000, closed: false, key, rateStart: performance.now(), messages: 0, bytes: 0 }
      } catch (error) { claims.delete(key); throw error }
    },
    async onLoadDocument({ documentName, document, context }) {
      const identity = parseRoom(documentName)
      if (rooms.size + loading >= options.maxRooms || process.memoryUsage().rss >= options.maxMemoryBytes) {
        claims.delete(context.key); throw new InternalFailure('COLLAB_MEMORY_LIMIT', 503)
      }
      loading++
      try {
        let pointer = await api.describe(identity.projectId), bytes: Uint8Array | undefined
        for (let count = 0; count < 3; count++) {
          if (pointer.epoch !== identity.epoch) throw new InternalFailure('COLLAB_EPOCH_CONFLICT', 409)
          try { bytes = await api.load(pointer); break }
          catch (error) {
            if (!(error instanceof InternalFailure) || error.code !== 'COLLAB_GENERATION_CONFLICT') throw error
            pointer = await api.describe(identity.projectId)
          }
        }
        if (!bytes) throw new InternalFailure('COLLAB_GENERATION_CONFLICT', 409)
        const doc = loadDocument(bytes, identity)
        try { document.merge(doc) } finally { doc.destroy() }
        const room = new Room(document, pointer, api, state => {
          document.broadcastStateless(JSON.stringify(state))
          // A previously failed last-member flush has no future disconnect to trigger eviction.
          if ('status' in state && state.status === 'durable' && document.getConnectionsCount() === 0)
            setTimeout(() => { void server.hocuspocus.unloadDocument(document).catch(() => {}) }, 0)
        },
          () => server.hocuspocus.closeConnections(documentName))
        rooms.set(documentName, room); awarenessOwners.set(documentName, new Map())
      } catch (error) { claims.delete(context.key); throw error }
      finally { loading-- }
    },
    async connected({ context, connection, documentName }) {
      writable(context); armLease(context, connection)
      connection.sendStateless(JSON.stringify({ type: 'ready', identity: { ...context.identity, connectionId: context.key } }))
      const room = rooms.get(documentName)
      if (room) connection.sendStateless(JSON.stringify(room.state()))
    },
    async beforeHandleMessage({ context, update, documentName, document }) {
      writable(context)
      if (update.byteLength > LIMITS.updateBytes + 1024) throw new InternalFailure('COLLAB_MESSAGE_TOO_LARGE', 413)
      const now = performance.now()
      if (now - context.rateStart >= 1000) { context.rateStart = now; context.messages = 0; context.bytes = 0 }
      if (++context.messages > options.maxMessagesPerSecond || (context.bytes += update.byteLength) > options.maxBytesPerSecond)
        throw new InternalFailure('COLLAB_RATE_LIMIT', 429)
      try {
      const decoder = decoding.createDecoder(update)
      decoding.readVarString(decoder) // Hocuspocus validates the document/session address before this hook.
      const type = decoding.readVarUint(decoder)
      if (![0, 1, 3, 4, 7].includes(type)) throw new InternalFailure('COLLAB_MESSAGE_TYPE_DENIED', 400)
      if (type === 0 || type === 4) {
        const syncType = decoding.readVarUint(decoder), payload = decoding.readVarUint8Array(decoder)
        if (decoding.hasContent(decoder) || ![0, 1, 2].includes(syncType)) throw new InternalFailure('COLLAB_MESSAGE_INVALID', 400)
        if (syncType !== 0) {
          const room = rooms.get(documentName)
          if (!room) throw new InternalFailure('COLLAB_ROOM_UNAVAILABLE')
          // Own the only mutation path: validate, record pending, apply and broadcast synchronously.
          // The stock receiver then applies the identical CRDT update, which is idempotent.
          room.accept(payload)
        }
      } else if (type === 1) {
        // Validate raw client IDs, including removals (scratch Awareness omits null states).
        const payload = decoding.readVarUint8Array(decoder)
        if (payload.byteLength > 8192 || decoding.hasContent(decoder)) throw new InternalFailure('COLLAB_AWARENESS_INVALID', 400)
        const awareness = decoding.createDecoder(payload), count = decoding.readVarUint(awareness)
        if (count > options.maxRoomConnections + 1) throw new InternalFailure('COLLAB_AWARENESS_INVALID', 400)
        const incoming: { id: number; state: Record<string, unknown> | null }[] = []
        for (let i = 0; i < count; i++) {
          const id = decoding.readVarUint(awareness); decoding.readVarUint(awareness)
          incoming.push({ id, state: JSON.parse(decoding.readVarString(awareness)) })
        }
        if (decoding.hasContent(awareness)) throw new InternalFailure('COLLAB_AWARENESS_INVALID', 400)
        const owners = awarenessOwners.get(documentName)!
        if (context.awarenessId === undefined) {
          const own = incoming.filter(item => item.state !== null && !owners.has(item.id))
          if (own.length !== 1) throw new InternalFailure('COLLAB_AWARENESS_INVALID', 400)
          context.awarenessId = own[0].id
        }
        const own = incoming.find(item => item.id === context.awarenessId)
        if (own?.state === null && owners.get(own.id) === context.key)
          removeAwarenessStates(document.awareness, [own.id], 'gateway-awareness-remove')
      }
      } catch (error) {
        if (error instanceof InternalFailure) throw error
        // Decoders/JSON errors can embed input fragments. Only a stable code reaches framework logging.
        throw new InternalFailure('COLLAB_MESSAGE_INVALID', 400)
      }
    },
    async beforeHandleAwareness({ context, states, documentName, document }) {
      if (!context) throw new InternalFailure('COLLAB_AWARENESS_INVALID', 400)
      writable(context)
      const owners = awarenessOwners.get(documentName)!
      for (const [id, state] of states) {
        // Provider initial sync may echo peer states; scratch Awareness also has a synthetic local state.
        // Neither is client-authoritative. Only the ID bound from the raw inbound frame can pass.
        if (id !== context.awarenessId) { states.delete(id); continue }
        if (owners.has(id) && owners.get(id) !== context.key || JSON.stringify(state).length > 4096)
          throw new InternalFailure('COLLAB_AWARENESS_INVALID', 400)
        if (Object.keys(state).some(key => !['user', 'cursor', 'selection', 'activeFileId'].includes(key))) throw new InternalFailure('COLLAB_AWARENESS_INVALID', 400)
        if (state.activeFileId !== undefined && state.activeFileId !== null && (typeof state.activeFileId !== 'string' || !document.getMap('files').has(state.activeFileId)))
          throw new InternalFailure('COLLAB_AWARENESS_INVALID', 400)
        if (state.cursor !== undefined && !validSelection(state.cursor) || state.selection !== undefined && !validSelection(state.selection))
          throw new InternalFailure('COLLAB_AWARENESS_INVALID', 400)
        context.awarenessId = id; owners.set(id, context.key)
        states.set(id, { ...state, user: { id: context.identity.userId, name: context.identity.displayName, color: context.identity.avatarColor, connectionId: context.key } })
      }
    },
    async onDisconnect({ context, documentName, document }) {
      if (!context) return
      context.closed = true; clearTimeout(context.leaseTimer); clearTimeout(context.renewTimer); claims.delete(context.key)
      if (context.awarenessId !== undefined) awarenessOwners.get(documentName)?.delete(context.awarenessId)
      if (document.getConnectionsCount() === 0) await rooms.get(documentName)?.flush().catch(() => {})
    },
    async onStoreDocument({ documentName }) { await rooms.get(documentName)?.flush() },
    async beforeUnloadDocument({ documentName }) {
      const room = rooms.get(documentName)
      if (room && !room.canUnload()) throw new InternalFailure('COLLAB_UNDURABLE_ROOM')
    },
    async afterUnloadDocument({ documentName }) {
      rooms.get(documentName)?.dispose(); rooms.delete(documentName); awarenessOwners.delete(documentName)
    },
    async onRequest({ request, response }) {
      try {
        const match = /^\/internal\/collaboration\/projects\/([1-9]\d*)\/flush$/.exec(request.url ?? '')
        if (!match || request.method !== 'POST') { response.writeHead(404).end(); throw null }
        let size = 0; const chunks: Buffer[] = []
        for await (const chunk of request) { size += chunk.length; if (size > 4096) throw new InternalFailure('COLLAB_MESSAGE_TOO_LARGE', 413); chunks.push(chunk) }
        authenticateInternal(request, Buffer.concat(chunks), options.gatewaySecret, 'gateway', nonces)
        const id = Number(match[1]); if (!Number.isSafeInteger(id)) throw new InternalFailure('COLLAB_ROOM_INVALID', 400)
        if (!options.enabled || stopping) throw new InternalFailure('COLLAB_GATEWAY_DISABLED')
        const pointer = await api.describe(id)
        if ([...rooms.values()].some(room => room.pointer.projectId === id && room.pointer.epoch !== pointer.epoch && !room.canUnload()))
          throw new InternalFailure('COLLAB_EPOCH_CONFLICT', 409)
        const room = rooms.get(`project:${id}:epoch:${pointer.epoch}`)
        const saved = room ? await room.flush() : pointer
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ projectId: id, epoch: saved.epoch,
          generation: saved.generation, contentHash: saved.contentHash, durableSequence: room?.durableSequence ?? 0 }))
      } catch (error) {
        if (error !== null) response.writeHead(error instanceof InternalFailure ? error.status : 503).end(JSON.stringify({ code: 'COLLAB_FLUSH_FAILED' }))
      }
      throw null
    },
  })
  server.httpServer.requestTimeout = 15000; server.httpServer.headersTimeout = 10000
  return { server, rooms,
    stop(): Promise<void> {
      return stopPromise ??= (async () => {
        stopping = true
        // Freeze new input, capture and flush all accepted work before destroying documents.
        await Promise.all([...rooms.values()].map(room => room.flush()))
        await server.destroy()
        for (const socket of sockets) socket.destroy()
        nonces.close()
      })().catch(error => { stopPromise = undefined; throw error })
    },
  }
}
