import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { CollaborationSession } from './session'
import { ApiError } from '../api/client'
import { fileCommands, readDocument } from './document'
import { cacheName, OfflineLog, OFFLINE_LIMIT, purgeUserCaches } from './offline'

const mocks = vi.hoisted(() => ({ ticket: vi.fn(), project: vi.fn(), providers: [] as { configuration: Record<string, (event: unknown) => void>; awareness: Awareness }[] }))
vi.mock('../api/collaboration', () => ({ issueTicket: mocks.ticket }))
vi.mock('../api/teams', () => ({ getTeamProject: mocks.project }))
vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProviderWebsocket: class { destroy() {} connect() { return Promise.resolve() } },
  HocuspocusProvider: class {
    awareness: Awareness
    constructor(readonly configuration: Record<string, (event: unknown) => void> & { document: Y.Doc }) {
      this.awareness = new Awareness(configuration.document); mocks.providers.push(this)
    }
    destroy() { this.awareness.destroy() } attach() {}
  },
}))
const sessions: CollaborationSession[] = []

it('retains its local log and pauses editing on a temporary project fence', async () => {
  const { session, callbacks } = await connected()
  await session.flushLocal()
  callbacks.onClose({ event: { code: 1000, reason: 'COLLAB_PROJECT_FENCED' } })
  expect(session.state.writable).toBe(false)
  expect(session.state.connection).not.toBe('forbidden')
  expect(session.doc.getMap('meta').get('projectId')).toBe(7)
  expect((await indexedDB.databases()).map(db => db.name)).toContain(cacheName(101, { projectId: 7, epoch: 1 }))
})

it('clears content and the local log on a Hocuspocus document revocation frame', async () => {
  const { session, callbacks } = await connected()
  await session.flushLocal()
  callbacks.onClose({ event: { code: 1000, reason: 'COLLAB_USER_REVOKED' } })
  expect(session.state.connection).toBe('forbidden')
  expect(session.doc.getMap('files').size).toBe(0)
  await vi.waitFor(async () => expect((await indexedDB.databases()).map(db => db.name)).not.toContain(cacheName(101, { projectId: 7, epoch: 1 })))
})
afterEach(async () => {
  for (const session of sessions) { await session.flushLocal(); session.destroy() }
  sessions.length = 0; await purgeUserCaches(101); mocks.providers.length = 0; vi.clearAllMocks()
})
async function connected() {
  mocks.ticket.mockResolvedValue({ projectId: 7, epoch: 1, ticket: 'memory-only' })
  const session = new CollaborationSession({ projectId: 7, epoch: 1 }, 101, 9, 'ws://localhost/collaboration')
  sessions.push(session); await session.connect()
  if (!session.doc.getMap('meta').size) {
    session.doc.transact(() => {
      const file = new Y.Map<unknown>()
      Object.entries({ id: 'entry', path: '/index.html', language: 'html', deletedAt: null, content: new Y.Text('hello') }).forEach(([k, v]) => file.set(k, v))
      session.doc.getMap('files').set('entry', file); session.doc.getArray('fileOrder').push(['entry'])
      Object.entries({ schemaVersion: 1, projectId: 7, epoch: 1, entryFileId: 'entry' }).forEach(([k, v]) => session.doc.getMap('meta').set(k, v))
    }, 'remote')
  }
  const provider = mocks.providers.at(-1)!, callbacks = provider.configuration
  callbacks.onStateless({ payload: JSON.stringify({ type: 'ready', identity: { userId: 101, projectId: 7, epoch: 1, teamId: 9, displayName: 'Member', avatarColor: '#123456', connectionId: `tab-${mocks.providers.length}` } }) })
  callbacks.onStateless({ payload: JSON.stringify({ type: 'persistence', projectId: 7, epoch: 1, generation: 1,
    contentHash: 'a'.repeat(64), acceptedHash: 'b'.repeat(64), durableHash: 'b'.repeat(64), dirtySequence: 0, durableSequence: 0, status: 'pending' }) })
  callbacks.onSynced({ state: true }); expect(session.state.writable).toBe(true)
  return { session, provider, callbacks }
}
describe('offline collaboration lifecycle', () => {
  it('continues text/structure editing offline and restores the update log after a fresh authorized session', async () => {
    const { session, callbacks } = await connected()
    callbacks.onClose({ event: { code: 1006 } }); expect(session.state.writable).toBe(true)
    session.mutate(doc => {
      const id = fileCommands(doc, session.identity, () => true).create('/offline.js')
      ;(doc.getMap<Y.Map<unknown>>('files').get(id)!.get('content') as Y.Text).insert(0, 'offline edit')
    })
    await session.flushLocal(); expect(session.state.local).toBe('saved'); session.destroy()
    const reopened = await connected()
    expect(readDocument(reopened.session.doc, session.identity).files.find(f => f.path === '/offline.js')?.content.toString()).toBe('offline edit')
    expect(reopened.session.state.pendingBytes).toBeGreaterThan(0)
  })
  it('does not use offline mode to bypass a room persistence pause', async () => {
    const { session, callbacks } = await connected()
    const failed = { type: 'persistence', projectId: 7, epoch: 1, generation: 1, contentHash: 'a'.repeat(64), acceptedHash: 'b'.repeat(64), durableHash: 'b'.repeat(64), dirtySequence: 1, durableSequence: 0, status: 'failed' }
    callbacks.onStateless({ payload: JSON.stringify(failed) }); callbacks.onClose({ event: { code: 1006 } })
    expect(session.state.writable).toBe(false)
    expect(() => session.mutate(d => fileCommands(d, session.identity, () => true).create('/denied.js'))).toThrow()
  })
  it('rejects an oversized pending transaction before mutating the live Y.Doc', async () => {
    const { session } = await connected(), before = Y.encodeStateAsUpdate(session.doc)
    expect(() => session.mutate(doc => {
      const commands = fileCommands(doc, session.identity, () => true)
      for (const path of ['/a.js', '/b.js']) {
        const id = commands.create(path)
        ;(doc.getMap<Y.Map<unknown>>('files').get(id)!.get('content') as Y.Text).insert(0, 'x'.repeat(OFFLINE_LIMIT / 2))
      }
    })).toThrow('容量上限')
    expect(Y.encodeStateAsUpdate(session.doc)).toEqual(before); expect(session.state.writable).toBe(false)
  })
  it('guards repeated text undo/redo and retains remote text', async () => {
    const { session } = await connected(), origin = Symbol('input'), undo = new Y.UndoManager(session.doc.getMap('files'), { trackedOrigins: new Set([origin]) })
    const edit = (doc: Y.Doc) => (doc.getMap<Y.Map<unknown>>('files').get('entry')!.get('content') as Y.Text).insert(0, 'local ')
    session.mutate(edit, origin)
    const remote = new Y.Doc(); Y.applyUpdate(remote, Y.encodeStateAsUpdate(session.doc))
    ;(remote.getMap<Y.Map<unknown>>('files').get('entry')!.get('content') as Y.Text).insert(0, 'remote ')
    Y.applyUpdate(session.doc, Y.encodeStateAsUpdate(remote), 'remote')
    for (let i = 0; i < 3; i++) {
      session.undo(undo, false); expect(readDocument(session.doc, session.identity).files[0].content.toString()).toBe('remote hello')
      session.undo(undo, true); expect(readDocument(session.doc, session.identity).files[0].content.toString()).toBe('remote local hello')
    }
    undo.destroy(); remote.destroy()
  })
  it('retains a remote-deleted active file and refuses export after revocation', async () => {
    const { session } = await connected()
    const id = session.mutate(doc => fileCommands(doc, session.identity, () => true).create('/local.js'))
    session.setActiveFile(id)
    session.mutate(doc => (doc.getMap<Y.Map<unknown>>('files').get(id)!.get('content') as Y.Text).insert(0, 'keep this'))
    const remote = new Y.Doc(); Y.applyUpdate(remote, Y.encodeStateAsUpdate(session.doc))
    fileCommands(remote, session.identity, () => true).remove(id)
    Y.applyUpdate(session.doc, Y.encodeStateAsUpdate(remote), 'remote')
    expect(session.state.recoveries?.[0].code).toBe('keep this')
    mocks.project.mockRejectedValue(new ApiError('denied', 403))
    await expect(session.exportFiles()).rejects.toThrow('denied')
    expect(session.state.connection).toBe('forbidden'); expect(session.state.recoveries).toEqual([])
    await purgeUserCaches(101)
    expect((await indexedDB.databases()).some(db => db.name === cacheName(101, session.identity))).toBe(false)
    remote.destroy()
  })
  it('clears unopened old cache when the first ticket request denies access', async () => {
    const doc = new Y.Doc(), identity = { projectId: 7, epoch: 1 }, log = new OfflineLog(cacheName(101, identity), identity, () => {})
    await log.load(doc); await log.close()
    mocks.ticket.mockRejectedValue(new ApiError('denied', 403))
    const session = new CollaborationSession(identity, 101, 9); sessions.push(session); await session.connect()
    await purgeUserCaches(101)
    expect(session.state.connection).toBe('forbidden')
    expect((await indexedDB.databases()).some(db => db.name === cacheName(101, identity))).toBe(false); doc.destroy()
  })
  it('never sends an old-epoch cache to a newly authorized epoch', async () => {
    const { session } = await connected(); await session.flushLocal(); session.destroy()
    mocks.ticket.mockResolvedValue({ projectId: 7, epoch: 2, ticket: 'new-epoch' })
    const stale = new CollaborationSession({ projectId: 7, epoch: 1 }, 101, 9)
    sessions.push(stale); const count = mocks.providers.length; await stale.connect()
    expect(stale.state.connection).toBe('forbidden'); expect(mocks.providers.length).toBe(count)
    expect(stale.doc.getMap('files').size).toBe(0)
    await purgeUserCaches(101)
  })
  it('restores unresolved deletion recovery from cached file IDs without a second source copy', async () => {
    const { session } = await connected()
    const id = session.mutate(doc => fileCommands(doc, session.identity, () => true).create('/conflict.js'))
    session.setActiveFile(id)
    session.mutate(doc => (doc.getMap<Y.Map<unknown>>('files').get(id)!.get('content') as Y.Text).insert(0, 'recover after reload'))
    const remote = new Y.Doc(); Y.applyUpdate(remote, Y.encodeStateAsUpdate(session.doc))
    fileCommands(remote, session.identity, () => true).remove(id)
    Y.applyUpdate(session.doc, Y.encodeStateAsUpdate(remote), 'remote')
    await session.flushLocal(); session.destroy()
    const reopened = await connected()
    expect(reopened.session.state.recoveries?.[0]).toEqual({ id, path: '/conflict.js', code: 'recover after reload' })
    reopened.session.dismissRecovery(id); await reopened.session.flushLocal(); remote.destroy()
  })
})
