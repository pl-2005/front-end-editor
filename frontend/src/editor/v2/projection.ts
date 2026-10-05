import type { CollaborationSession } from '../../collaboration/session'
import { readDocument } from '../../collaboration/document'
import { prepareSandpackFiles } from '../sandpackRuntime'
import type { ProjectFiles } from '../../types/project'
export function previewProjection(session: Pick<CollaborationSession, 'doc' | 'identity'>) {
  const { files, entryFileId } = readDocument(session.doc, session.identity)
  const source = Object.fromEntries(files.map(f => [f.path, { code: f.content.toString() }])) as ProjectFiles
  // Runtime dependencies belong only to the preview, never the authoritative Y.Doc.
  if (!source['/package.json']) source['/package.json'] = { code: JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '4.1.4', 'esbuild-wasm': '0.17.12' }, type: 'module' }) }
  return { files: prepareSandpackFiles(source), entry: files.find(f => f.id === entryFileId)!.path }
}
