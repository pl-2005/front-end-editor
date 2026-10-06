import * as Y from 'yjs'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { ApiError } from '../api/client'
import { issueTicket } from '../api/collaboration'
import { fingerprint, LIMITS, readDocument, STRUCTURE_ORIGIN, type Identity } from './document'
import { cacheName, clearOtherEpochs, OfflineLog, OFFLINE_LIMIT, purgeProjectCaches, type LocalStatus } from './offline'
import { getAuthUser, getAuthSession, subscribeAuth } from '../api/auth'
import { getTeamProject } from '../api/teams'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import { presenceColors } from './presenceColors'

export type ConnectionState = 'connecting' | 'syncing' | 'online' | 'offline' | 'reconnecting' | 'forbidden' | 'failed'
export interface Persistence {
  type: 'persistence'; projectId: number; epoch: number; generation: number; contentHash: string; acceptedHash: string; durableHash: string
  dirtySequence: number; durableSequence: number; status: 'pending' | 'durable' | 'failed' | 'forbidden'
}
export interface Presence { clientId: number; userId: number; connectionId: string; name: string; color: string; activeFileId?: string }
export interface Recovery { id: string; path: string; code: string }
export interface SessionState { connection: ConnectionState; synced: boolean; writable: boolean; persistence?: Persistence; localHash?: string; error: string; revision: number; local?: LocalStatus; pendingBytes?: number; members?: Presence[]; recoveries?: Recovery[] }
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
  doc = new Y.Doc({ gc: false })
  awareness = new Awareness(this.doc)
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
  private authorized = false
  private paused = false
  private capacityBlocked = false
  private log?: OfflineLog
  private loading?: Promise<void>
  private pendingBytes = 0
  private localOrigins = new Set<unknown>([STRUCTURE_ORIGIN])
  private localFiles = new Set<string>()
  private activeFileId?: string
  private unsubscribeAuth?: () => void
  constructor(readonly identity: Identity, readonly userId: number, readonly teamId: number, private url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/collaboration`) {
    this.doc.on('update', this.updated)
    this.doc.getMap('files').observeDeep(this.deleted)
    const authSession = getAuthSession()
    if (getAuthUser()?.id === userId) this.unsubscribeAuth = subscribeAuth(() => {
      if (getAuthSession() !== authSession || getAuthUser()?.id !== userId) this.forbid()
    })
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.state
  private set(patch: Partial<SessionState>) {
    if (this.stopped) return
    this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn())
  }
  private updated = (update: Uint8Array, origin: unknown) => {
    const local = this.localOrigins.has(origin)
    if (local) this.pendingBytes += update.byteLength
    if (origin !== this.log) this.log?.save(update, local)
    this.set({ localHash: undefined, revision: this.state.revision + 1, pendingBytes: this.pendingBytes })
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
        this.acknowledge()
      }).catch(() => this.set({ connection: 'failed', writable: false, error: '无法核对持久化状态' }))
    }, 100)
  }
  private confirmSync() {
    if (!this.ready || !this.transportSynced || !this.state.persistence) return
    try {
      readDocument(this.doc, this.identity)
      this.authorized = true
      this.paused = ['failed', 'forbidden'].includes(this.state.persistence?.status ?? '')
      this.set({ synced: true, connection: 'online', writable: this.canEdit(), error: this.editingError() })
      this.retries = 0; this.scheduleHash()
    } catch (error) { this.set({ connection: 'failed', synced: false, writable: false, error: error instanceof Error ? error.message : '文档校验失败' }) }
  }
  private releaseTransport() {
    this.provider?.awareness?.off('change', this.presenceChanged)
    this.awareness.setLocalState(null)
    removeAwarenessStates(this.awareness, [...this.awareness.getStates().keys()], 'disconnect')
    this.set({ members: [] })
    this.controller?.abort(); this.provider?.destroy(); this.websocket?.destroy()
    this.provider = undefined; this.websocket = undefined
  }
  private retry(attempt: number) {
    if (this.stopped || attempt !== this.attempt || this.timer) return
    this.ready = false; this.transportSynced = false
    this.provider?.awareness?.off('change', this.presenceChanged)
    removeAwarenessStates(this.awareness, [...this.awareness.getStates().keys()], 'disconnect')
    this.set({ members: [] })
    this.set({ connection: 'offline', synced: false, writable: this.canEdit(), localHash: undefined })
    this.timer = setTimeout(() => { this.timer = undefined; void this.connect() }, Math.min(10000, 500 * 2 ** Math.min(this.retries++, 5)))
  }
  private forbid() {
    if (this.stopped || this.state.connection === 'forbidden') return
    this.set({ connection: 'forbidden', writable: false })
    this.attempt++; clearTimeout(this.timer); clearTimeout(this.hashTimer); this.timer = undefined
    this.authorized = false; this.unsubscribeAuth?.(); this.releaseTransport()
    void purgeProjectCaches(this.userId, this.identity.projectId).catch(() => this.set({ error: '授权失效，本地缓存清理失败，请清除站点数据' }))
    this.doc.off('update', this.updated); this.doc.getMap('files').unobserveDeep(this.deleted); this.awareness.destroy(); this.doc.destroy(); this.doc = new Y.Doc()
    this.awareness = new Awareness(this.doc); this.awareness.setLocalState(null)
    this.localOrigins.clear(); this.localFiles.clear(); this.pendingBytes = 0
    this.set({ connection: 'forbidden', synced: false, writable: false, localHash: undefined, persistence: undefined, members: [], recoveries: [], revision: this.state.revision + 1, error: '项目授权已失效，请返回团队页面' })
  }
  async connect() {
    if (this.stopped || this.state.connection === 'forbidden') return
    const attempt = ++this.attempt
    this.releaseTransport(); this.ready = false; this.transportSynced = false
    this.set({ connection: this.retries ? 'reconnecting' : 'connecting', synced: false, writable: this.canEdit(), persistence: undefined, error: '' })
    const controller = new AbortController(); this.controller = controller
    try {
      const ticket = await issueTicket(this.identity.projectId, controller.signal)
      if (this.stopped || attempt !== this.attempt) return
      if (ticket.projectId !== this.identity.projectId || ticket.epoch !== this.identity.epoch) { this.forbid(); return }
      if (!this.loading) this.loading = this.loadCache()
      await this.loading
      if (this.stopped || attempt !== this.attempt) return
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
              this.provider?.awareness?.setLocalStateField('user', { id: id.userId, name: id.displayName, color: id.avatarColor, connectionId: id.connectionId })
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
          // Hocuspocus 4.7 document CLOSE frames are surfaced with code 1000 and the server reason.
          if (event.code === 4403 || ['COLLAB_USER_REVOKED', 'COLLAB_PROJECT_DELETED', 'COLLAB_AUTHORIZATION_EXPIRED'].includes(event.reason ?? '')) this.forbid()
          else if (event.code === 4410 || event.reason === 'COLLAB_PROJECT_FENCED') {
            this.paused = true; this.set({ connection: 'failed', writable: false, synced: false, error: '项目正在处理，请等待后重试' }); this.retry(attempt)
          }
          else if (event.reason?.includes('COLLAB_UPDATE_')) {
            this.set({ connection: 'failed', writable: false, synced: false, error: '编辑未被网关接受，请重新打开项目' })
            this.attempt++; this.releaseTransport()
          } else this.retry(attempt)
        },
      })
      this.provider = provider; provider.attach()
      provider.awareness?.on('change', this.presenceChanged)
      provider.awareness?.setLocalState({ activeFileId: this.activeFileId ?? null, selection: null })
      void websocket.connect().catch(() => { if (current()) this.retry(attempt) })
    } catch (error) {
      if (this.stopped || attempt !== this.attempt || controller.signal.aborted) return
      if (error instanceof ApiError && [401, 403, 404, 410].includes(error.status)) this.forbid()
      else if (error instanceof ApiError && error.code === 'COLLAB_TICKETS_DISABLED') {
        this.set({ connection: 'failed', synced: false, writable: false, error: '协作编辑暂未开放：请开启本机票据与网关服务后刷新页面' })
      } else { this.set({ error: '连接失败，正在重试' }); this.retry(attempt) }
    }
  }
  destroy() {
    if (this.stopped) return
    this.stopped = true; this.attempt++; clearTimeout(this.timer); clearTimeout(this.hashTimer)
    this.releaseTransport(); this.unsubscribeAuth?.(); void this.log?.close().catch(() => {})
    this.doc.off('update', this.updated); this.doc.getMap('files').unobserveDeep(this.deleted); this.listeners.clear(); this.awareness.destroy(); this.doc.destroy()
  }
  private canEdit() { return this.authorized && !this.paused && !this.capacityBlocked && !['loading', 'failed'].includes(this.state.local ?? '') && this.pendingBytes < OFFLINE_LIMIT }
  private editingError() {
    return this.paused ? '房间持久化暂停，暂时只读' : this.state.local === 'failed' ? '本地日志保存失败，暂停编辑；请恢复网络后导出'
      : this.capacityBlocked ? '本地待同步日志已达容量上限，请恢复网络同步或验证权限后导出' : ''
  }
  private async loadCache() {
    this.set({ local: 'loading', writable: false })
    try {
      await clearOtherEpochs(this.userId, this.identity)
      if (this.stopped || this.snapshot().connection === 'forbidden') return
      this.log = new OfflineLog(cacheName(this.userId, this.identity), this.identity, local => {
        this.set({ local: this.capacityBlocked && local !== 'failed' ? 'full' : local })
        this.set({ writable: this.canEdit(), error: this.editingError() })
      }, () => this.forbid())
      this.pendingBytes = await this.log.load(this.doc)
      if (this.stopped || this.state.connection === 'forbidden') return
      const files = this.doc.getMap<Y.Map<unknown>>('files'), recoveries: Recovery[] = []
      for (const id of this.log.recoveryIds) {
        const file = files.get(id)
        if (file?.get('deletedAt') !== null && file?.get('content') instanceof Y.Text) recoveries.push({ id, path: file.get('path') as string, code: (file.get('content') as Y.Text).toString() })
      }
      this.set({ recoveries })
      if (this.pendingBytes >= OFFLINE_LIMIT) { this.capacityBlocked = true; this.set({ local: 'full', writable: false }) }
      this.set({ pendingBytes: this.pendingBytes })
    } catch { if (!this.stopped && this.state.connection !== 'forbidden') this.set({ local: 'failed', writable: false, error: '无法恢复本地日志，已暂停编辑；请恢复网络后导出' }) }
  }
  private acknowledge() {
    if (!isDurable(this.state)) return
    this.pendingBytes = 0; this.capacityBlocked = false; this.localFiles.clear()
    this.log?.acknowledge(fingerprint(this.doc))
    this.set({ pendingBytes: 0, local: this.state.local === 'full' ? this.log?.state ?? 'saved' : this.state.local })
    this.set({ writable: this.canEdit(), error: this.editingError() })
  }
  /** Validate a prospective transaction before touching the live document. */
  mutate<T>(action: (doc: Y.Doc) => T, origin: unknown = STRUCTURE_ORIGIN): T {
    if (!this.state.writable) throw new Error('当前连接不可编辑')
    const scratch = new Y.Doc({ gc: false }), updates: Uint8Array[] = []
    try {
      Y.applyUpdate(scratch, Y.encodeStateAsUpdate(this.doc))
      scratch.on('update', update => updates.push(update))
      action(scratch); readDocument(scratch, this.identity)
      this.checkBudget(updates.reduce((n, u) => n + u.byteLength, 0))
    } finally { scratch.destroy() }
    this.localOrigins.add(origin)
    let result!: T
    this.doc.transact(() => { result = action(this.doc) }, origin)
    return result
  }
  private checkBudget(bytes: number) {
    if (bytes > LIMITS.updateBytes || this.pendingBytes + bytes + 1024 > OFFLINE_LIMIT) {
      this.capacityBlocked = true
      this.set({ local: 'full', writable: false, error: '本地待同步日志已达容量上限，请恢复网络同步或验证权限后导出' })
      throw new Error('本地待同步日志已达容量上限')
    }
  }
  undo(manager: Y.UndoManager, redo: boolean) {
    if (!this.state.writable) return
    const scratch = new Y.Doc({ gc: false }), updates: Uint8Array[] = []
    let preview: Y.UndoManager | undefined
    try {
      Y.applyUpdate(scratch, Y.encodeStateAsUpdate(this.doc))
      // Redo links are transient metadata, omitted from the wire encoding.
      scratch.transact(tx => {
        for (const structs of this.doc.store.clients.values()) for (const item of structs) if (item instanceof Y.Item && item.redone) {
          const copy = Y.getItemCleanStart(tx, item.id); copy.redone = item.redone
          Y.getItemCleanEnd(tx, scratch.store, Y.createID(item.id.client, item.id.clock + item.length - 1))
        }
      })
      preview = new Y.UndoManager(scratch.getMap('files'))
      preview.undoStack = [...manager.undoStack]; preview.redoStack = [...manager.redoStack]
      scratch.on('update', u => updates.push(u))
      if (redo) preview.redo(); else preview.undo()
      readDocument(scratch, this.identity); this.checkBudget(updates.reduce((n, u) => n + u.byteLength, 0))
    } finally { preview?.destroy(); scratch.destroy() }
    this.localOrigins.add(manager)
    if (redo) manager.redo(); else manager.undo()
  }
  markEdited(fileId: string) { this.localFiles.add(fileId) }
  forgetOrigin(origin: unknown) { this.localOrigins.delete(origin) }
  flushLocal() { return this.log?.settled() ?? Promise.resolve() }
  private deleted = (events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => {
    if (this.localOrigins.has(transaction.origin)) return
    const recoveries = [...(this.state.recoveries ?? [])]
    for (const event of events) if (event instanceof Y.YMapEvent && event.keysChanged.has('deletedAt') && event.target.get('deletedAt') !== null) {
      const id = event.target.get('id') as string
      if ((id === this.activeFileId || this.localFiles.has(id) || this.pendingBytes > 0 || this.log?.recoveryIds.includes(id)) && !recoveries.some(r => r.id === id)) {
        recoveries.push({ id, path: event.target.get('path') as string, code: (event.target.get('content') as Y.Text).toString() })
      }
    }
    if (recoveries.length !== (this.state.recoveries?.length ?? 0)) {
      this.set({ recoveries }); this.log?.rememberRecoveries(recoveries.map(r => r.id))
    }
  }
  dismissRecovery(id: string) {
    const recoveries = this.state.recoveries?.filter(r => r.id !== id) ?? []
    this.set({ recoveries }); this.log?.rememberRecoveries(recoveries.map(r => r.id))
  }
  setActiveFile(id: string) {
    this.activeFileId = id
    this.awareness.setLocalState({ activeFileId: id, selection: null })
    this.provider?.awareness?.setLocalStateField('activeFileId', id)
    this.provider?.awareness?.setLocalStateField('selection', null)
  }
  setSelection(selection: { anchor: Y.RelativePosition; head: Y.RelativePosition } | null) {
    if (this.state.synced) this.provider?.awareness?.setLocalStateField('selection', selection)
  }
  private presenceChanged = () => {
    const source = this.provider?.awareness, states = source?.getStates(), members: Presence[] = []
    if (states) for (const [clientId, state] of states) {
      const user = state.user
      if (user && Number.isSafeInteger(user.id) && typeof user.connectionId === 'string' && typeof user.name === 'string' && /^#[a-f0-9]{6}$/i.test(user.color)) {
        members.push({ clientId, userId: user.id, connectionId: user.connectionId, name: user.name, color: user.color, activeFileId: state.activeFileId })
      }
    }
    if (source) applyAwarenessUpdate(this.awareness, encodeAwarenessUpdate(source, [...states!.keys()].filter(id => id !== this.doc.clientID)), 'transport')
    removeAwarenessStates(this.awareness, [...this.awareness.getStates().keys()].filter(id => id !== this.doc.clientID && !states?.has(id)), 'transport')
    const colors = presenceColors([this.userId, ...members.map(member => member.userId)])
    this.set({ members: members.map(member => ({ ...member, color: colors.get(member.userId)! })).sort((a, b) => a.userId - b.userId || a.connectionId.localeCompare(b.connectionId)) })
  }
  async exportFiles() {
    if (this.stopped || this.state.connection === 'forbidden') throw new Error('项目授权已失效')
    const attempt = this.attempt
    let project
    try { project = await getTeamProject(this.teamId, this.identity.projectId) }
    catch (error) { if (error instanceof ApiError && [401, 403, 404, 410].includes(error.status)) this.forbid(); throw error }
    if (this.stopped || attempt !== this.attempt || project.collaboration.epoch !== this.identity.epoch) throw new Error('项目状态已变化，不能导出旧缓存')
    return JSON.stringify({ projectId: this.identity.projectId, epoch: this.identity.epoch,
      entryFileId: readDocument(this.doc, this.identity).entryFileId,
      files: readDocument(this.doc, this.identity).files.map(f => ({ path: f.path, code: f.content.toString() })), recoveries: this.state.recoveries ?? [] }, null, 2)
  }
  async copyRecovery(id: string) {
    await this.exportFiles()
    const recovery = this.state.recoveries?.find(r => r.id === id)
    if (!recovery || this.stopped || this.state.connection === 'forbidden') throw new Error('恢复内容已失效')
    await navigator.clipboard.writeText(recovery.code)
  }
}
