import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { createDocument, encodeDocument, loadDocument } from '../dist/document.js'
import { Room } from '../dist/room.js'
import { InternalFailure, NonceStore } from '../dist/internal.js'
import { hash } from '../dist/hmac.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'

function fixture(options = {}) {
  const doc = createDocument({ projectId: 1, epoch: 1 }, '/index.html', [{ path: '/index.html', code: 'initial' }])
  let bytes = encodeDocument(doc, { projectId: 1, epoch: 1 })
  let pointer = { projectId: 1, epoch: 1, generation: 1, size: bytes.length, contentHash: hash(bytes) }
  const receipts = new Map(), calls = []
  const api = {
    describe: async () => ({ ...pointer }), load: async () => bytes,
    persist: async (expected, key, next) => {
      calls.push({ expected: { ...expected }, key, bytes: new Uint8Array(next) })
      if (receipts.has(key)) return receipts.get(key)
      if (expected.epoch !== pointer.epoch) throw new InternalFailure('COLLAB_EPOCH_CONFLICT', 409)
      if (expected.generation !== pointer.generation) throw new InternalFailure('COLLAB_GENERATION_CONFLICT', 409)
      bytes = new Uint8Array(next); pointer = { ...pointer, generation: pointer.generation + 1, size: bytes.length, contentHash: hash(bytes) }
      receipts.set(key, { ...pointer }); return { ...pointer }
    },
  }
  const room = new Room(doc, pointer, api, () => {}, () => {}, options)
  return { doc, api, room, calls, get bytes() { return bytes }, get pointer() { return pointer },
    edit(text) {
      const copy = loadDocument(encodeDocument(doc, room.identity), room.identity), file = copy.getMap('files').values().next().value
      let update; copy.on('update', value => { update = value }); file.get('content').insert(0, text)
      copy.destroy(); room.accept(update)
    },
    async cleanup() { if (!room.frozen) await room.flush(); if (room.canUnload()) room.dispose(); doc.destroy() },
  }
}
test('scratch validation rejects malicious update without changing room or pending', async () => {
  const f = fixture()
  try {
    const before = encodeDocument(f.doc, f.room.identity), bad = loadDocument(before, f.room.identity)
    let update; bad.on('update', value => { update = value }); bad.getMap('meta').set('epoch', 2); bad.destroy()
    assert.throws(() => f.room.accept(update), /COLLAB_UPDATE_INVALID/)
    assert.deepEqual(encodeDocument(f.doc, f.room.identity), before)
    assert.equal(f.room.pending.length, 0); assert.equal(f.room.dirtySequence, 0)
    assert.throws(() => f.room.accept(new Uint8Array([255])), /COLLAB_UPDATE_INVALID/)
  } finally { await f.cleanup() }
})
test('one persist promise captures sequence and retains edits accepted during upload', async () => {
  const f = fixture(); let release, started
  const wait = new Promise(resolve => { release = resolve }), entered = new Promise(resolve => { started = resolve })
  const persist = f.api.persist; let first = true
  f.api.persist = async (...args) => { if (first) { first = false; started(); await wait } return persist(...args) }
  try {
    f.edit('A'); const flush = f.room.flush(), concurrent = f.room.flush(); await entered
    f.edit('B'); release(); await Promise.all([flush, concurrent])
    assert.equal(f.calls.length, 1); assert.equal(f.room.durableSequence, 1); assert.equal(f.room.dirtySequence, 2)
    assert.equal(f.room.pending.length, 1)
    await f.room.flush(); assert.equal(f.room.pending.length, 0); assert.equal(f.pointer.generation, 3)
  } finally { release(); await f.cleanup() }
})
test('lost response retries identical key/body and uses original durable receipt', async () => {
  const f = fixture(), persist = f.api.persist; let lost = true
  f.api.persist = async (...args) => { const result = await persist(...args); if (lost) { lost = false; throw new Error('response lost') } return result }
  try {
    f.edit('lost'); await assert.rejects(f.room.flush())
    assert.ok(f.room.paused); assert.equal(f.room.pending.length, 1); assert.equal(f.room.durableSequence, 0)
    assert.throws(() => f.edit('rejected'), /COLLAB_ROOM_READ_ONLY/)
    await f.room.flush()
    assert.equal(f.calls[0].key, f.calls[1].key); assert.deepEqual(f.calls[0].bytes, f.calls[1].bytes)
    assert.equal(f.pointer.generation, 2); assert.equal(f.room.durableSequence, 1); assert.equal(f.room.paused, false)
  } finally { await f.cleanup() }
})
test('same-epoch CAS conflict merges authority and pending rather than overwriting remote text', async () => {
  const f = fixture()
  try {
    const remote = loadDocument(f.bytes, { projectId: 1, epoch: 1 })
    remote.getMap('files').values().next().value.get('content').insert(0, 'REMOTE')
    await f.api.persist(f.pointer, 'remote', encodeDocument(remote, { projectId: 1, epoch: 1 })); remote.destroy()
    f.edit('LOCAL'); await f.room.flush()
    const saved = loadDocument(f.bytes, f.room.identity), text = saved.getMap('files').values().next().value.get('content').toString()
    assert.ok(text.includes('REMOTE')); assert.ok(text.includes('LOCAL')); saved.destroy()
    assert.equal(f.pointer.generation, 3); assert.equal(f.room.pending.length, 0)
  } finally { await f.cleanup() }
})
test('storage failure retains room, bounded pending rejects overflow, epoch conflict fences', async () => {
  const f = fixture({ maxPendingUpdates: 1 }), persist = f.api.persist
  try {
    f.edit('A'); assert.throws(() => f.edit('B'), /COLLAB_PENDING_LIMIT/)
    f.api.persist = async () => { throw new InternalFailure('COLLAB_STORAGE_FAILED') }
    await assert.rejects(f.room.flush()); assert.equal(f.room.canUnload(), false)
    assert.throws(() => f.room.dispose(), /COLLAB_UNDURABLE_ROOM/)
    f.api.persist = persist; await f.room.flush(); assert.equal(f.room.canUnload(), true)
  } finally { await f.cleanup() }
  const g = fixture(); g.edit('A'); g.api.persist = async () => { throw new InternalFailure('COLLAB_EPOCH_CONFLICT', 409) }
  await assert.rejects(g.room.flush()); assert.ok(g.room.frozen); assert.equal(g.room.pending.length, 1); g.doc.destroy()
})
test('maximum delay flushes sustained edits despite debounce resets', async () => {
  const f = fixture({ debounceMs: 200, maxDelayMs: 60 })
  try {
    f.edit('A'); await new Promise(resolve => setTimeout(resolve, 25)); f.edit('B')
    await new Promise(resolve => setTimeout(resolve, 70))
    assert.equal(f.room.durableSequence, 2); assert.equal(f.calls.length, 1)
  } finally { await f.cleanup() }
})
test('receiver nonce remains consumed after reopening persistent replay database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'step06-nonce-')), path = join(dir, 'nonce.sqlite')
  try {
    const first = new NonceStore(path); first.claim('gateway', 'test-nonce'); first.close()
    const second = new NonceStore(path)
    try { assert.throws(() => second.claim('gateway', 'test-nonce'), /COLLAB_INTERNAL_UNAUTHORIZED/) } finally { second.close() }
  } finally {
    const target = resolve(dir), within = relative(resolve(tmpdir()), target)
    assert.ok(within && !within.startsWith('..') && !within.includes(':'))
    rmSync(target, { recursive: true, force: true })
  }
})
