import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { fileCommands, fingerprint, readDocument, STRUCTURE_ORIGIN } from './document'
import { resolvedPaths } from '../../../collaboration/src/document-rules'

import { fixture } from '../test/collaborationFixture'
describe('collaborative file commands', () => {
  it('normalizes paths, preserves identity/text on cross-extension rename and prevents entry deletion', () => {
    const f = fixture()
    try {
      const id = f.commands.create('scripts\\ｈｅｌｐｅｒ.js'), text = readDocument(f.doc, f.identity).files.find(x => x.id === id)!.content
      text.insert(0, 'export const answer = 42')
      f.commands.rename(id, '/helper.txt')
      const record = readDocument(f.doc, f.identity).files.find(x => x.id === id)!
      expect(record.content).toBe(text); expect(record.language).toBe('plaintext')
      expect(() => f.commands.remove('entry')).toThrow('入口')
      expect(() => f.commands.create('/../escape.js')).toThrow()
      f.commands.setEntry(id); f.commands.remove('entry')
      expect(f.doc.getMap<Y.Map<unknown>>('files').get('entry')!.get('deletedAt')).not.toBeNull()
    } finally { f.doc.destroy() }
  })
  it('merges multi-file updates and excludes remote transactions from local undo', () => {
    const f = fixture(), remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(f.doc))
    const undo = new Y.UndoManager([f.doc.getMap('files'), f.doc.getMap('meta'), f.doc.getArray('fileOrder')], { trackedOrigins: new Set([STRUCTURE_ORIGIN]) })
    try {
      f.commands.create('/local.js')
      fileCommands(remote, f.identity, () => true).create('/remote.css')
      Y.applyUpdate(f.doc, Y.encodeStateAsUpdate(remote), 'remote')
      undo.undo()
      expect(readDocument(f.doc, f.identity).files.map(x => x.path)).toEqual(['/index.html', '/remote.css'])
      undo.redo(); expect(readDocument(f.doc, f.identity).files).toHaveLength(3)
    } finally { undo.destroy(); remote.destroy(); f.doc.destroy() }
  })
  it('isolates unknown schemas and denies commands while read-only', () => {
    const f = fixture()
    try {
      expect(() => fileCommands(f.doc, f.identity, () => false).create('/no.js')).toThrow('不可编辑')
      f.doc.getMap('meta').set('schemaVersion', 99)
      const before = Y.encodeStateAsUpdate(f.doc)
      expect(() => readDocument(f.doc, f.identity)).toThrow('隔离')
      expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before)
    } finally { f.doc.destroy() }
  })
  it('resolves collisions deterministically and includes text-only deletions in the fingerprint', () => {
    const input = [{ id: 'b', path: '/same.js' }, { id: 'a', path: '/same.js' }, { id: 'c', path: '/same~62.js' }]
    expect([...resolvedPaths(input)]).toEqual([...resolvedPaths([...input].reverse())])
    expect(resolvedPaths(input).get('a')).toBe('/same.js')
    expect(new Set(resolvedPaths(input).values()).size).toBe(3)
    const f = fixture()
    try {
      const before = fingerprint(f.doc), vector = Y.encodeStateVector(f.doc)
      readDocument(f.doc, f.identity).files[0].content.delete(0, 1)
      expect(Y.encodeStateVector(f.doc)).toEqual(vector); expect(fingerprint(f.doc)).not.toBe(before)
    } finally { f.doc.destroy() }
  })
})
