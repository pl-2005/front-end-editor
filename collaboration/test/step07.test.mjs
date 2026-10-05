import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { createDocument, encodeDocument, fingerprint, loadDocument } from '../dist/document.js'
import { Room } from '../dist/room.js'
import { hash } from '../dist/hmac.js'

function fixture() {
  const identity = { projectId: 1, epoch: 1 }
  const doc = createDocument(identity, '/index.html', [{ path: '/index.html', code: '<h1>Initial</h1>' }])
  const bytes = encodeDocument(doc, identity), pointer = { ...identity, generation: 1, size: bytes.length, contentHash: hash(bytes) }
  const room = new Room(doc, pointer, { persist: async (expected, key, value) => ({ ...expected, generation: expected.generation + 1, contentHash: hash(value), size: value.length }) })
  return { identity, doc, bytes, room, async cleanup() { await room.flush(); room.dispose(); doc.destroy() } }
}
function create(doc, id, path) {
  doc.transact(() => {
    const file = new Y.Map()
    file.set('id', id); file.set('path', path); file.set('language', 'javascript'); file.set('deletedAt', null); file.set('content', new Y.Text(id))
    doc.getMap('files').set(id, file); doc.getArray('fileOrder').push([id])
  })
}
test('concurrent same-path files are repaired before broadcast, persisted and converge on clients', async () => {
  const f = fixture(), a = loadDocument(f.bytes, f.identity), b = loadDocument(f.bytes, f.identity)
  try {
    let updateA, updateB
    a.on('update', u => { updateA = u }); b.on('update', u => { updateB = u })
    create(a, 'a', '/same.js'); create(b, 'b', '/same.js')
    f.room.accept(updateB); f.room.accept(updateA)
    const repaired = encodeDocument(f.doc, f.identity)
    Y.applyUpdate(a, repaired); Y.applyUpdate(b, repaired)
    assert.equal(a.getMap('files').get('a').get('path'), '/same.js')
    assert.notEqual(a.getMap('files').get('b').get('path'), '/same.js')
    assert.equal(fingerprint(a), fingerprint(b)); assert.equal(fingerprint(a), fingerprint(f.doc))
    await f.room.flush()
    assert.equal(f.room.state().acceptedHash, f.room.state().durableHash)
  } finally { a.destroy(); b.destroy(); await f.cleanup() }
})
test('delete-only updates invalidate durable state and GC differences do not invalidate confirmation', async () => {
  const f = fixture(), client = loadDocument(f.bytes, f.identity)
  const text = client.getMap('files').values().next().value.get('content'), undo = new Y.UndoManager(text)
  try {
    const vector = Y.encodeStateVector(client), before = f.room.state().durableHash
    let update; client.on('update', u => { update = u }); text.delete(0, 3)
    f.room.accept(update)
    assert.deepEqual(Y.encodeStateVector(client), vector)
    assert.notEqual(f.room.state().acceptedHash, before)
    assert.equal(hash(Buffer.from(fingerprint(client))), f.room.state().acceptedHash)
    await f.room.flush()
    assert.equal(f.room.state().durableHash, f.room.state().acceptedHash)
    undo.undo(); f.room.accept(update); await f.room.flush()
    assert.equal(hash(Buffer.from(fingerprint(client))), f.room.state().durableHash)
  } finally { undo.destroy(); client.destroy(); await f.cleanup() }
})
