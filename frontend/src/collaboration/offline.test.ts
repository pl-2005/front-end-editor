import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  cacheName,
  clearOtherEpochs,
  OfflineLog,
  purgeUserCaches,
  type LocalStatus,
} from './offline'
import { fixture } from '../test/collaborationFixture'
import { fingerprint } from './document'

describe('bounded offline update log', () => {
  it('restores text and atomic structure after closing and preserves simultaneous tab writes', async () => {
    const f = fixture(),
      name = cacheName(91, f.identity),
      other = new Y.Doc()
    const a = new OfflineLog(name, f.identity, () => {}),
      b = new OfflineLog(name, f.identity, () => {})
    await a.load(other)
    a.save(Y.encodeStateAsUpdate(f.doc))
    await a.settled()
    const tab = new Y.Doc()
    await b.load(tab)
    const updates: Uint8Array[] = []
    f.doc.on('update', (u) => updates.push(u))
    f.commands.create('/offline.js')
    a.save(Y.mergeUpdates(updates), true)
    const text = tab.getMap<Y.Map<unknown>>('files').get('entry')!.get('content') as Y.Text
    const peer: Uint8Array[] = []
    tab.on('update', (u) => peer.push(u))
    text.insert(0, 'peer ')
    b.save(Y.mergeUpdates(peer), true)
    await Promise.all([a.close(), b.close()])
    const restored = new Y.Doc(),
      log = new OfflineLog(name, f.identity, () => {})
    expect(await log.load(restored)).toBeGreaterThan(0)
    expect(restored.getMap('files').size).toBe(2)
    expect(
      (restored.getMap<Y.Map<unknown>>('files').get('entry')!.get('content') as Y.Text).toString(),
    ).toContain('peer')
    log.acknowledge(fingerprint(restored))
    await log.settled()
    await log.close()
    const latest = new Y.Doc(),
      reader = new OfflineLog(name, f.identity, () => {})
    expect(await reader.load(latest)).toBe(0)
    await reader.close(true)
    f.doc.destroy()
    other.destroy()
    tab.destroy()
    restored.destroy()
    latest.destroy()
  })
  it('does not clear pending peer updates with a stale durable acknowledgement', async () => {
    const f = fixture(),
      name = cacheName(92, f.identity),
      doc = new Y.Doc(),
      log = new OfflineLog(name, f.identity, () => {})
    await log.load(doc)
    log.save(Y.encodeStateAsUpdate(f.doc))
    await log.settled()
    const confirmed = fingerprint(f.doc),
      updates: Uint8Array[] = []
    f.doc.on('update', (u) => updates.push(u))
    f.commands.create('/pending.css')
    log.save(Y.mergeUpdates(updates), true)
    log.acknowledge(confirmed)
    await log.close()
    const restored = new Y.Doc(),
      reader = new OfflineLog(name, f.identity, () => {})
    expect(await reader.load(restored)).toBeGreaterThan(0)
    await reader.close(true)
    f.doc.destroy()
    doc.destroy()
    restored.destroy()
  })
  it('isolates old epochs and purges only the revoked user', async () => {
    const identity = { projectId: 81, epoch: 1 }
    for (const user of [93, 94]) {
      const log = new OfflineLog(cacheName(user, identity), identity, () => {}),
        doc = new Y.Doc()
      await log.load(doc)
      await log.close()
      doc.destroy()
    }
    await clearOtherEpochs(93, { ...identity, epoch: 2 })
    expect((await indexedDB.databases()).some((db) => db.name === cacheName(93, identity))).toBe(
      false,
    )
    expect((await indexedDB.databases()).some((db) => db.name === cacheName(94, identity))).toBe(
      true,
    )
    await purgeUserCaches(94)
    expect((await indexedDB.databases()).some((db) => db.name === cacheName(94, identity))).toBe(
      false,
    )
  })
  it('reports an aborted write and retains the last committed state', async () => {
    const f = fixture(),
      statuses: LocalStatus[] = [],
      name = cacheName(95, f.identity),
      doc = new Y.Doc()
    const log = new OfflineLog(name, f.identity, (s) => statuses.push(s))
    await log.load(doc)
    log.save(Y.encodeStateAsUpdate(f.doc))
    await log.settled()
    log.save(new Uint8Array([255, 255]), true)
    await log.settled()
    expect(statuses.at(-1)).toBe('failed')
    await log.close()
    const restored = new Y.Doc(),
      reader = new OfflineLog(name, f.identity, () => {})
    await reader.load(restored)
    expect(restored.getMap('files').size).toBe(1)
    await reader.close(true)
    f.doc.destroy()
    doc.destroy()
    restored.destroy()
  })
  it('notifies active editors when their shared cache is revoked', async () => {
    const identity = { projectId: 99, epoch: 1 },
      name = cacheName(96, identity),
      a = new Y.Doc(),
      b = new Y.Doc()
    let cleared = 0
    const first = new OfflineLog(
      name,
      identity,
      () => {},
      () => {
        cleared++
      },
    )
    const peer = new OfflineLog(
      name,
      identity,
      () => {},
      () => {
        cleared++
      },
    )
    await first.load(a)
    await peer.load(b)
    await first.close(true)
    expect(cleared).toBe(2)
    await peer.close()
    a.destroy()
    b.destroy()
  })
})
