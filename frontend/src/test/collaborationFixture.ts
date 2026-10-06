import * as Y from 'yjs'
import { fileCommands } from '../collaboration/document'

export function fixture() {
  const doc = new Y.Doc(), identity = { projectId: 7, epoch: 1 }
  doc.transact(() => {
    const meta = doc.getMap('meta'), files = doc.getMap('files')
    meta.set('schemaVersion', 1); meta.set('projectId', 7); meta.set('epoch', 1); meta.set('entryFileId', 'entry')
    const file = new Y.Map<unknown>()
    file.set('id', 'entry'); file.set('path', '/index.html'); file.set('language', 'html'); file.set('deletedAt', null); file.set('content', new Y.Text('<h1>Hello</h1>'))
    files.set('entry', file); doc.getArray('fileOrder').push(['entry'])
  })
  return { doc, identity, commands: fileCommands(doc, identity, () => true) }
}
