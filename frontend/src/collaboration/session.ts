import * as Y from 'yjs'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { ApiError } from '../api/client'
import { issueTicket } from '../api/collaboration'
import { fingerprint, readDocument, type Identity } from './document'

export type ConnectionState = 'connecting' | 'syncing' | 'online' | 'offline' | 'reconnecting' | 'forbidden' | 'failed'
export interface Persistence {
  type: 'persistence'; projectId: number; epoch: number; generation: number; contentHash: string; acceptedHash: string; durableHash: string
  dirtySequence: number; durableSequence: number; status: 'pending' | 'durable' | 'failed' | 'forbidden'
}
export interface SessionState { connection: ConnectionState; synced: boolean; writable: boolean; persistence?: Persistence; localHash?: string; error: string; revision: number }
const initial: SessionState = { connection: 'connecting', synced: false, writable: false, error: '', revision: 0 }
export function isDurable(state: SessionState) {
  const p = state.persistence
  return state.synced && !!state.localHash && p?.status === 'durable' && p.durableSequence >= p.dirtySequence
    && p.durableHash === state.localHash && p.acceptedHash === state.localHash
}
export function parsePersistence(value: unknown, identity: Identity): Persistence {
  const p = value as Persistence
  if (!p || p.type !== 'persistence' || p.projectId !== identity.projectId || p.epoch !== identity.epoch
    || !Number.isSafeInteger(p.generation) || p.generation < 1 || !Number.isSafeInteger(p.dirtySequence) || p.dirtySequence < 0
    || !Number.isSafeInteger(p.durableSequence) || p.durableSequence < 0 || p.durableSequence > p.dirtySequence
    || !/^[a-f0-9]{64}$/.test(p.contentHash) || !/^[a-f0-9]{64}$/.test(p.acceptedHash) || !/^[a-f0-9]{64}$/.test(p.durableHash)
    || !['pending', 'durable', 'failed', 'forbidden'].includes(p.status)) throw new Error('协作状态消息无效')
  return p
}
/** One document per session; each transport attempt obtains a fresh single-use ticket. */
export class CollaborationSession {
  doc = new Y.Doc()
  state = initial
  private listeners = new Set<() => void>()
  private provider?: HocuspocusProvider
  private websocket?: HocuspocusProviderWebsocket
  private controller?: AbortController
  private timer?: ReturnType<typeof setTimeout>
  private hashTimer?: ReturnType<typeof setTimeout>
  private stopped = false
  private attempt = 0
  private retries = 0
  private ready = false
  private transportSynced = false
  constructor(readonly identity: Identity, readonly userId: number, readonly teamId: number, private url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/collaboration`) {
    this.doc.on('update', this.updated)
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.state
  private set(patch: Partial<SessionState>) {
    if (this.stopped) return
    this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn())
  }
  private updated = () => {
    this.set({ localHash: undefined, revision: this.state.revision + 1 })
    if (this.transportSynced && this.ready) this.confirmSync()
    this.scheduleHash()
  }
  private scheduleHash() {
    clearTimeout(this.hashTimer)
    const revision = this.state.revision
    this.hashTimer = setTimeout(() => {
      let bytes: Uint8Array<ArrayBuffer>
      try { bytes = new TextEncoder().encode(fingerprint(this.doc)) } catch { return }
      void crypto.subtle.digest('SHA-256', bytes).then(hash => {
        if (this.state.revision !== revision || this.stopped) return
        this.set({ localHash: [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join('') })
      }).catch(() => this.set({ connection: 'failed', writable: false, error: '无法核对持久化状态' }))
    }, 100)
  }
  private confirmSync() {
    if (!this.ready || !this.transportSynced || !this.state.persistence) return
    try {
      readDocument(this.doc, this.identity)
      const paused = ['failed', 'forbidden'].includes(this.state.persistence?.status ?? '')
      this.set({ synced: true, connection: 'online', writable: !paused, error: paused ? '房间持久化暂停，暂时只读' : '' })
      this.retries = 0; this.scheduleHash()
    } catch (error) { this.set({ connection: 'failed', synced: false, writable: false, error: error instanceof Error ? error.message : '文档校验失败' }) }
  }
  private releaseTransport() {
    this.controller?.abort(); this.provider?.destroy(); this.websocket?.destroy()
    this.provider = undefined; this.websocket = undefined
  }
  private retry(attempt: number) {
    if (this.stopped || attempt !== this.attempt || this.timer) return
    this.ready = false; this.transportSynced = false
    this.set({ connection: 'offline', synced: false, writable: false, localHash: undefined })
    this.timer = setTimeout(() => { this.timer = undefined; void this.connect() }, Math.min(10000, 500 * 2 ** Math.min(this.retries++, 5)))
  }
  private forbid() {
    this.attempt++; clearTimeout(this.timer); clearTimeout(this.hashTimer); this.timer = undefined
    this.releaseTransport(); this.doc.off('update', this.updated); this.doc.destroy(); this.doc = new Y.Doc()
    this.set({ connection: 'forbidden', synced: false, writable: false, localHash: undefined, persistence: undefined, revision: this.state.revision + 1, error: '项目授权已失效，请返回团队页面' })
  }
  async connect() {
    const attempt = ++this.attempt
    this.releaseTransport(); this.ready = false; this.transportSynced = false
    this.set({ connection: this.retries ? 'reconnecting' : 'connecting', synced: false, writable: false, persistence: undefined, error: '' })
    const controller = new AbortController(); this.controller = controller
    try {
      const ticket = await issueTicket(this.identity.projectId, controller.signal)
      if (this.stopped || attempt !== this.attempt) return
      if (ticket.projectId !== this.identity.projectId || ticket.epoch !== this.identity.epoch) { this.forbid(); return }
      const websocket = new HocuspocusProviderWebsocket({ url: this.url, autoConnect: false, maxAttempts: 1 })
      this.websocket = websocket
      const current = () => !this.stopped && attempt === this.attempt
      const provider = new HocuspocusProvider({ websocketProvider: websocket, name: `project:${ticket.projectId}:epoch:${ticket.epoch}`, document: this.doc, token: ticket.ticket,
        onAuthenticated: () => { if (current()) this.set({ connection: 'syncing' }) },
        onSynced: ({ state }) => { if (current()) { this.transportSynced = state; this.confirmSync() } },
        onStateless: ({ payload }) => {
          if (!current()) return
          try {
            const value = JSON.parse(payload)
            if (value.type === 'ready') {
              const id = value.identity
              if (!id || id.projectId !== this.identity.projectId || id.epoch !== this.identity.epoch || id.userId !== this.userId || id.teamId !== this.teamId) { this.forbid(); return }
              this.ready = true; this.confirmSync()
            } else if (value.type === 'persistence') {
              const persistence = parsePersistence(value, this.identity)
              this.set({ persistence }); if (persistence.status === 'forbidden') this.forbid(); else this.confirmSync()
            }
          } catch { this.set({ connection: 'failed', writable: false, error: '协作消息校验失败' }) }
        },
        onAuthenticationFailed: () => { if (current()) this.retry(attempt) },
        onClose: ({ event }) => {
          if (!current()) return
          if (event.code === 4403) this.forbid()
          else if (event.reason?.includes('COLLAB_UPDATE_')) {
            this.set({ connection: 'failed', writable: false, synced: false, error: '编辑未被网关接受，请重新打开项目' })
            this.attempt++; this.releaseTransport()
          } else this.retry(attempt)
        },
      })
      this.provider = provider; provider.attach()
      void websocket.connect().catch(() => { if (current()) this.retry(attempt) })
    } catch (error) {
      if (this.stopped || attempt !== this.attempt || controller.signal.aborted) return
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) this.forbid()
      else if (error instanceof ApiError && error.code === 'COLLAB_TICKETS_DISABLED') {
        this.set({ connection: 'failed', synced: false, writable: false, error: '协作编辑暂未开放：请开启本机票据与网关服务后刷新页面' })
      } else { this.set({ error: '连接失败，正在重试' }); this.retry(attempt) }
    }
  }
  destroy() {
    this.stopped = true; this.attempt++; clearTimeout(this.timer); clearTimeout(this.hashTimer)
    this.releaseTransport(); this.doc.off('update', this.updated); this.listeners.clear(); this.doc.destroy()
  }
}
