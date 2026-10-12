// Run from repository root: node docs/V__3/evidence/yjs-risk-probe.mjs
// Pure in-memory review evidence; no application, services, credentials or network.
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const require = createRequire(new URL('../../../frontend/package.json', import.meta.url))
const Y = require('yjs')

function concurrentMoves() {
  const initial = '<main><section>A</section><aside>B</aside><footer>C</footer></main>'
  const base = new Y.Doc({ gc: false })
  const a = new Y.Doc({ gc: false })
  const b = new Y.Doc({ gc: false })
  base.getText('html').insert(0, initial)
  for (const doc of [a, b]) Y.applyUpdate(doc, Y.encodeStateAsUpdate(base))
  const fragment = '<section>A</section>'
  const start = initial.indexOf(fragment)
  for (const [doc, target] of [[a, initial.indexOf('</main>')], [b, initial.indexOf('<footer>')]]) {
    doc.transact(() => {
      doc.getText('html').insert(target, fragment)
      doc.getText('html').delete(start, fragment.length)
    })
  }
  const ua = Y.encodeStateAsUpdate(a)
  const ub = Y.encodeStateAsUpdate(b)
  Y.applyUpdate(a, ub)
  Y.applyUpdate(b, ua)
  const html = a.getText('html').toString()
  assert.equal(html, b.getText('html').toString())
  assert.equal(html.split(fragment).length - 1, 2)
  const result = { scenario: 'concurrent-subtree-moves', converged: true, html }
  for (const doc of [base, a, b]) doc.destroy()
  return result
}

function undoRemoteContribution() {
  const a = new Y.Doc({ gc: false })
  const b = new Y.Doc({ gc: false })
  const origin = {}
  const undo = new Y.UndoManager([a.getMap('files'), a.getArray('fileOrder')], {
    trackedOrigins: new Set([origin]),
  })
  a.transact(() => {
    const file = new Y.Map()
    file.set('content', new Y.Text('local'))
    a.getMap('files').set('css', file)
    a.getArray('fileOrder').push(['css'])
  }, origin)
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  b.getMap('files').get('css').get('content').insert(5, 'REMOTE')
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
  const before = a.getMap('files').get('css').get('content').toString()
  undo.undo()
  assert.equal(before, 'localREMOTE')
  assert.equal(a.getMap('files').has('css'), false)
  assert.deepEqual(a.getArray('fileOrder').toArray(), [])
  const result = { scenario: 'undo-file-with-remote-contribution', before, afterFileExists: false, fileOrder: [] }
  undo.destroy()
  a.destroy()
  b.destroy()
  return result
}

console.log(JSON.stringify({ yjs: require('yjs/package.json').version, results: [concurrentMoves(), undoRemoteContribution()] }, null, 2))
