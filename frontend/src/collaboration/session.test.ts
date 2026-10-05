import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { CollaborationSession, isDurable, parsePersistence, type SessionState } from './session'
import { ApiError } from '../api/client'

const mocks = vi.hoisted(() => ({ ticket: vi.fn(), providers: [] as { configuration: Record<string, (event: unknown) => void>; destroy: ReturnType<typeof vi.fn> }[], sockets: [] as { destroy: ReturnType<typeof vi.fn> }[] }))
vi.mock('../api/collaboration', () => ({ issueTicket: mocks.ticket }))
vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProviderWebsocket: class {
    destroy = vi.fn(); connect = vi.fn().mockResolvedValue(undefined)
    constructor() { mocks.sockets.push(this) }
  },
  HocuspocusProvider: class {
    destroy = vi.fn(); attach = vi.fn()
    constructor(readonly configuration: Record<string, (event: unknown) => void>) { mocks.providers.push(this) }
  },
}))
const persistence = { type: 'persistence', projectId: 7, epoch: 1, generation: 2, contentHash: 'a'.repeat(64), acceptedHash: 'b'.repeat(64), durableHash: 'b'.repeat(64), dirtySequence: 2, durableSequence: 2, status: 'durable' }
describe('collaboration session', () => {
  afterEach(() => { vi.useRealTimers(); mocks.providers.length = 0; mocks.sockets.length = 0; mocks.ticket.mockReset() })
  it('never treats old durable receipts or transport connection alone as saved', () => {
    const state: SessionState = { connection: 'online', synced: true, writable: true, revision: 0, error: '', persistence: parsePersistence(persistence, { projectId: 7, epoch: 1 }), localHash: 'b'.repeat(64) }
    expect(isDurable(state)).toBe(true)
    expect(isDurable({ ...state, localHash: undefined })).toBe(false)
    expect(isDurable({ ...state, localHash: 'c'.repeat(64) })).toBe(false)
    expect(isDurable({ ...state, synced: false })).toBe(false)
    expect(() => parsePersistence({ ...persistence, epoch: 2 }, { projectId: 7, epoch: 1 })).toThrow()
  })
  it('waits for initial persistence state before editing and pauses/resumes with the room', async () => {
    mocks.ticket.mockResolvedValue({ projectId: 7, epoch: 1, ticket: 'single-use' })
    const session = new CollaborationSession({ projectId: 7, epoch: 1 }, 4, 9, 'ws://localhost/collaboration')
    await session.connect()
    const meta = session.doc.getMap('meta'), file = new Y.Map<unknown>()
    session.doc.transact(() => {
      meta.set('schemaVersion', 1); meta.set('projectId', 7); meta.set('epoch', 1); meta.set('entryFileId', 'entry')
      file.set('id', 'entry'); file.set('path', '/index.html'); file.set('language', 'html'); file.set('deletedAt', null); file.set('content', new Y.Text('hello'))
      session.doc.getMap('files').set('entry', file); session.doc.getArray('fileOrder').push(['entry'])
    })
    const callbacks = mocks.providers[0].configuration
    callbacks.onStateless({ payload: JSON.stringify({ type: 'ready', identity: { projectId: 7, epoch: 1, userId: 4, teamId: 9 } }) })
    callbacks.onSynced({ state: true }); expect(session.state.writable).toBe(false)
    callbacks.onStateless({ payload: JSON.stringify({ ...persistence, status: 'failed' }) }); expect(session.state.writable).toBe(false)
    callbacks.onStateless({ payload: JSON.stringify(persistence) }); expect(session.state.writable).toBe(true)
    session.destroy()
  })
  it('obtains a new ticket on reconnect and destroys owned transports', async () => {
    vi.useFakeTimers(); mocks.ticket.mockResolvedValue({ projectId: 7, epoch: 1, ticket: 'single-use' })
    const session = new CollaborationSession({ projectId: 7, epoch: 1 }, 4, 9, 'ws://localhost/collaboration')
    await session.connect()
    mocks.providers[0].configuration.onClose({ event: { code: 1006 } })
    expect(session.state.writable).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.ticket).toHaveBeenCalledTimes(2)
    expect(mocks.providers[0].destroy).toHaveBeenCalledOnce()
    session.destroy(); expect(mocks.providers[1].destroy).toHaveBeenCalledOnce()
    expect(mocks.sockets.every(s => s.destroy.mock.calls.length === 1)).toBe(true)
  })
  it('does not revive a session from a late ticket or retry forbidden authorization', async () => {
    let resolve!: (value: unknown) => void
    mocks.ticket.mockImplementation(() => new Promise(r => { resolve = r }))
    const session = new CollaborationSession({ projectId: 7, epoch: 1 }, 4, 9, 'ws://localhost/collaboration')
    const connect = session.connect(); session.destroy(); resolve({ projectId: 7, epoch: 1, ticket: 'late' }); await connect
    expect(mocks.providers).toHaveLength(0)
    mocks.ticket.mockRejectedValue(new ApiError('forbidden', 403))
    const denied = new CollaborationSession({ projectId: 7, epoch: 1 }, 4, 9, 'ws://localhost/collaboration')
    await denied.connect(); expect(denied.state.connection).toBe('forbidden'); denied.destroy()
  })
  it('invalidates a previous save immediately when a local document changes', () => {
    const session = new CollaborationSession({ projectId: 7, epoch: 1 }, 4, 9, 'ws://localhost/collaboration')
    session.state = { connection: 'online', synced: true, writable: true, revision: 0, error: '', persistence: parsePersistence(persistence, { projectId: 7, epoch: 1 }), localHash: 'b'.repeat(64) }
    session.doc.getMap('test').set('value', new Y.Text('new'))
    expect(isDurable(session.state)).toBe(false); session.destroy()
  })
  it('stops retrying when collaboration tickets are administratively disabled', async () => {
    vi.useFakeTimers()
    mocks.ticket.mockRejectedValue(new ApiError('disabled', 503, 'COLLAB_TICKETS_DISABLED'))
    const session = new CollaborationSession({ projectId: 7, epoch: 1 }, 4, 9, 'ws://localhost/collaboration')
    await session.connect()
    expect(session.state.connection).toBe('failed'); expect(session.state.writable).toBe(false)
    expect(session.state.error).toContain('票据与网关')
    await vi.advanceTimersByTimeAsync(30000)
    expect(mocks.ticket).toHaveBeenCalledOnce(); expect(mocks.providers).toHaveLength(0)
    session.destroy()
  })
})
