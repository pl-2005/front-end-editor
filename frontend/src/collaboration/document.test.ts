import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { fileCommands, fingerprint, readDocument, STRUCTURE_ORIGIN } from './document'
import { resolvedPaths } from '../../../collaboration/src/document-rules'
import {
  validateDocument,
  copyDocument,
  fingerprint as serverFingerprint,
} from '../../../collaboration/src/document'

import { fixture } from '../test/collaborationFixture'
describe('collaborative file commands', () => {
  it('imports a batch in one update and synchronizes exact content to another peer', () => {
    const f = fixture(),
      peer = new Y.Doc()
    try {
      let updates = 0
      f.doc.on('update', () => {
        updates++
      })
      const ids = f.commands.importFiles([
        { path: '/src/a.js', code: 'const text = "你好"' },
        { path: '/empty.html', code: '' },
      ])
      expect(updates).toBe(1)
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(f.doc))
      expect(
        readDocument(peer, f.identity)
          .files.filter((file) => ids.includes(file.id))
          .map((file) => file.content.toString()),
      ).toEqual(['const text = "你好"', ''])
      validateDocument(peer, f.identity)
      expect(fingerprint(f.doc)).toBe(serverFingerprint(peer))
    } finally {
      f.doc.destroy()
      peer.destroy()
    }
  })

  it('rejects conflicting paths, oversized content and read-only imports without partial changes', () => {
    const f = fixture()
    try {
      const before = fingerprint(f.doc)
      for (const inputs of [
        [
          { path: '/new.js', code: 'ok' },
          { path: '/index.html', code: 'replacement' },
        ],
        [
          { path: '/same.js', code: '' },
          { path: '/same.js', code: '' },
        ],
        [
          { path: '/a.js', code: '' },
          { path: '/a.js/child.js', code: '' },
        ],
        [{ path: '/big.txt', code: '你'.repeat(400000) }],
        Array.from({ length: 100 }, (_, i) => ({ path: `/${i}.txt`, code: '' })),
        Array.from({ length: 11 }, (_, i) => ({
          path: `/${i}.txt`,
          code: 'a'.repeat(1024 * 1024),
        })),
      ]) {
        expect(() => f.commands.importFiles(inputs)).toThrow()
        expect(fingerprint(f.doc)).toBe(before)
      }
      expect(() =>
        fileCommands(f.doc, f.identity, () => false).importFiles([{ path: '/no.js', code: '' }]),
      ).toThrow('不可编辑')
      expect(fingerprint(f.doc)).toBe(before)
    } finally {
      f.doc.destroy()
    }
  })
  it('retains the parent after removing or moving its final child folder', () => {
    const f = fixture()
    try {
      f.commands.createDirectory('/parent/child')
      f.commands.removePath('/parent/child')
      expect(readDocument(f.doc, f.identity).directories).toEqual(['/parent'])
      f.commands.createDirectory('/other/child')
      f.commands.renamePath('/other/child', '/moved')
      expect(readDocument(f.doc, f.identity).directories).toEqual(['/moved', '/other', '/parent'])
    } finally {
      f.doc.destroy()
    }
  })
  it('merges concurrent first-time directory creation without losing either folder or changing fingerprint by arrival order', () => {
    const f = fixture(),
      remote = new Y.Doc()
    try {
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(f.doc))
      f.commands.createDirectory('/alpha')
      fileCommands(remote, f.identity, () => true).createDirectory('/beta')
      const localUpdate = Y.encodeStateAsUpdate(f.doc),
        remoteUpdate = Y.encodeStateAsUpdate(remote)
      Y.applyUpdate(f.doc, remoteUpdate)
      Y.applyUpdate(remote, localUpdate)
      expect(readDocument(f.doc, f.identity).directories).toEqual(['/alpha', '/beta'])
      expect(readDocument(remote, f.identity).directories).toEqual(['/alpha', '/beta'])
      expect(fingerprint(f.doc)).toBe(fingerprint(remote))
      expect(fingerprint(f.doc)).toBe(serverFingerprint(f.doc))
      validateDocument(f.doc, f.identity)
    } finally {
      f.doc.destroy()
      remote.destroy()
    }
  })
  it('persists and synchronizes empty directories with matching gateway fingerprints and copies', () => {
    const f = fixture(),
      remote = new Y.Doc()
    try {
      f.commands.createDirectory('/empty/nested')
      expect(readDocument(f.doc, f.identity).directories).toEqual(['/empty/nested'])
      validateDocument(f.doc, f.identity)
      expect(fingerprint(f.doc)).toBe(serverFingerprint(f.doc))
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(f.doc))
      expect(readDocument(remote, f.identity).directories).toEqual(['/empty/nested'])
      const copy = copyDocument(Y.encodeStateAsUpdate(f.doc), f.identity, {
        projectId: 8,
        epoch: 1,
      })
      expect(readDocument(copy, { projectId: 8, epoch: 1 }).directories).toEqual(['/empty/nested'])
      copy.destroy()
      expect(() => f.commands.createDirectory('/empty')).toThrow('已存在')
      expect(() => f.commands.createDirectory('/../invalid')).toThrow()
      expect(() => f.commands.create('/empty/nested')).toThrow()
    } finally {
      f.doc.destroy()
      remote.destroy()
    }
  })
  it('moves and renames a complete directory atomically while preserving IDs and text', () => {
    const f = fixture()
    try {
      const id = f.commands.create('/src/deep/a.js')
      f.commands.createDirectory('/src/empty')
      const content = readDocument(f.doc, f.identity).files.find((file) => file.id === id)!.content
      content.insert(0, 'const unchanged = true')
      let updates = 0
      f.doc.on('update', () => {
        updates++
      })
      f.commands.renamePath('/src', '/lib')
      expect(updates).toBe(1)
      const state = readDocument(f.doc, f.identity)
      expect(state.files.find((file) => file.id === id)?.path).toBe('/lib/deep/a.js')
      expect(state.files.find((file) => file.id === id)?.content).toBe(content)
      expect(state.directories).toEqual(['/lib', '/lib/empty'])
      const before = fingerprint(f.doc)
      expect(() => f.commands.renamePath('/lib', '/lib/empty/child')).toThrow('自身')
      expect(() => f.commands.renamePath('/lib', '/index.html')).toThrow('同名')
      expect(fingerprint(f.doc)).toBe(before)
      f.commands.create('/target/a.js')
      expect(() => f.commands.renamePath('/lib/deep/a.js', '/target/a.js')).toThrow('同名')
      validateDocument(f.doc, f.identity)
    } finally {
      f.doc.destroy()
    }
  })
  it('deletes and restores a subtree and refuses entry deletion or undo over a replacement', () => {
    const f = fixture()
    try {
      f.commands.create('/src/a.js')
      f.commands.create('/src/deep/b.css')
      f.commands.createDirectory('/src/empty')
      const receipt = f.commands.removePath('/src')
      expect(readDocument(f.doc, f.identity).files.map((file) => file.path)).toEqual([
        '/index.html',
      ])
      f.commands.restore(receipt)
      expect(readDocument(f.doc, f.identity).files).toHaveLength(3)
      expect(readDocument(f.doc, f.identity).directories).toEqual(['/src/empty'])
      f.commands.renamePath('/index.html', '/src/index.html')
      expect(() => f.commands.removePath('/src')).toThrow('入口')
      const deleted = f.commands.removePath('/src/a.js')
      f.commands.create('/src/a.js')
      const before = fingerprint(f.doc)
      expect(() => f.commands.restore(deleted)).toThrow('已存在')
      expect(fingerprint(f.doc)).toBe(before)
      validateDocument(f.doc, f.identity)
    } finally {
      f.doc.destroy()
    }
  })
  it('rejects malformed directory metadata and denies directory edits in read-only mode', () => {
    const f = fixture()
    try {
      expect(() => fileCommands(f.doc, f.identity, () => false).createDirectory('/no')).toThrow(
        '不可编辑',
      )
      f.doc.getMap('directories').set('/bad', false)
      expect(() => readDocument(f.doc, f.identity)).toThrow('文件夹')
      expect(() => validateDocument(f.doc, f.identity)).toThrow('文件夹')
    } finally {
      f.doc.destroy()
    }
  })
  it('normalizes paths, preserves identity/text on cross-extension rename and prevents entry deletion', () => {
    const f = fixture()
    try {
      const id = f.commands.create('scripts\\ｈｅｌｐｅｒ.js'),
        text = readDocument(f.doc, f.identity).files.find((x) => x.id === id)!.content
      text.insert(0, 'export const answer = 42')
      f.commands.rename(id, '/helper.txt')
      const record = readDocument(f.doc, f.identity).files.find((x) => x.id === id)!
      expect(record.content).toBe(text)
      expect(record.language).toBe('plaintext')
      expect(() => f.commands.remove('entry')).toThrow('入口')
      expect(() => f.commands.create('/../escape.js')).toThrow()
      f.commands.setEntry(id)
      f.commands.remove('entry')
      expect(f.doc.getMap<Y.Map<unknown>>('files').get('entry')!.get('deletedAt')).not.toBeNull()
    } finally {
      f.doc.destroy()
    }
  })
  it('merges multi-file updates and excludes remote transactions from local undo', () => {
    const f = fixture(),
      remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(f.doc))
    const undo = new Y.UndoManager(
      [f.doc.getMap('files'), f.doc.getMap('meta'), f.doc.getArray('fileOrder')],
      { trackedOrigins: new Set([STRUCTURE_ORIGIN]) },
    )
    try {
      f.commands.create('/local.js')
      fileCommands(remote, f.identity, () => true).create('/remote.css')
      Y.applyUpdate(f.doc, Y.encodeStateAsUpdate(remote), 'remote')
      undo.undo()
      expect(readDocument(f.doc, f.identity).files.map((x) => x.path)).toEqual([
        '/index.html',
        '/remote.css',
      ])
      undo.redo()
      expect(readDocument(f.doc, f.identity).files).toHaveLength(3)
    } finally {
      undo.destroy()
      remote.destroy()
      f.doc.destroy()
    }
  })
  it('isolates unknown schemas and denies commands while read-only', () => {
    const f = fixture()
    try {
      expect(() => fileCommands(f.doc, f.identity, () => false).create('/no.js')).toThrow(
        '不可编辑',
      )
      f.doc.getMap('meta').set('schemaVersion', 99)
      const before = Y.encodeStateAsUpdate(f.doc)
      expect(() => readDocument(f.doc, f.identity)).toThrow('隔离')
      expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before)
    } finally {
      f.doc.destroy()
    }
  })
  it('resolves collisions deterministically and includes text-only deletions in the fingerprint', () => {
    const input = [
      { id: 'b', path: '/same.js' },
      { id: 'a', path: '/same.js' },
      { id: 'c', path: '/same~62.js' },
    ]
    expect([...resolvedPaths(input)]).toEqual([...resolvedPaths([...input].reverse())])
    expect(resolvedPaths(input).get('a')).toBe('/same.js')
    expect(new Set(resolvedPaths(input).values()).size).toBe(3)
    const f = fixture()
    try {
      const before = fingerprint(f.doc),
        vector = Y.encodeStateVector(f.doc)
      readDocument(f.doc, f.identity).files[0].content.delete(0, 1)
      expect(Y.encodeStateVector(f.doc)).toEqual(vector)
      expect(fingerprint(f.doc)).not.toBe(before)
    } finally {
      f.doc.destroy()
    }
  })
})
