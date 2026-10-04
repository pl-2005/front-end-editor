import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { createDocument, encodeDocument, loadDocument, copyDocument, validateDocument, validatePath, LIMITS } from '../dist/document.js'
const identity = { projectId: 42, epoch: 1 }
const files = [{ path: '/index.html', code: '<h1>Hello</h1>' }, { path: '/index.js', code: 'console.log(1)' }]
test('initial Y.Doc survives binary reload with stable file identity and plain Y.Text', () => {
  const doc = createDocument(identity, '/index.html', files)
  const loaded = loadDocument(encodeDocument(doc, identity), identity)
  assert.deepEqual(loaded.getArray('fileOrder').toArray(), doc.getArray('fileOrder').toArray())
  const entry = loaded.getMap('files').get(loaded.getMap('meta').get('entryFileId'))
  assert.ok(entry.get('content') instanceof Y.Text)
  assert.equal(entry.get('content').toString(), files[0].code)
  doc.destroy(); loaded.destroy()
})
test('copy rebases identity into a fresh document and retains current file contents', () => {
  const doc = createDocument(identity, '/index.html', files)
  const copied = copyDocument(encodeDocument(doc, identity), identity, { projectId: 43, epoch: 1 })
  assert.equal(copied.getMap('meta').get('projectId'), 43)
  assert.notDeepEqual(copied.getArray('fileOrder').toArray(), doc.getArray('fileOrder').toArray())
  const entry = copied.getMap('files').get(copied.getMap('meta').get('entryFileId'))
  assert.equal(entry.get('content').toString(), files[0].code)
  doc.destroy(); copied.destroy()
})
test('rejects corrupt data, wrong identity, unsafe paths, duplicate paths and limits', () => {
  assert.throws(() => loadDocument(new Uint8Array([255, 0, 255]), identity))
  for (const path of ['/../x.js', '/a\\b.js', '/a//b.js', '/ａ.js', '/x.exe', '/x\u0000.js']) assert.throws(() => validatePath(path))
  assert.throws(() => createDocument(identity, '/index.html', [...files, files[0]]))
  assert.throws(() => createDocument(identity, '/index.html', [{ path: '/index.html', code: 'x'.repeat(LIMITS.fileBytes + 1) }]))
  assert.throws(() => createDocument(identity, '/missing.html', files))
  const doc = createDocument(identity, '/index.html', files)
  assert.throws(() => loadDocument(encodeDocument(doc, identity), { projectId: 42, epoch: 2 }))
  doc.getMap('files').get(doc.getMap('meta').get('entryFileId')).set('deletedAt', Date.now())
  assert.throws(() => validateDocument(doc, identity))
  doc.destroy()
})
