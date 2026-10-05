import * as Y from 'yjs'
import { documentFingerprint, LIMITS, normalizePath, resolvedPaths, validatePath } from '../../../collaboration/src/document-rules'
export { LIMITS, normalizePath }
export const STRUCTURE_ORIGIN = Symbol('local-file-command')
export interface FileRecord { id: string; path: string; language: string; content: Y.Text; deletedAt: number | null }
export interface Identity { projectId: number; epoch: number }
const byteLength = (value: string) => new TextEncoder().encode(value).length
export function fingerprint(doc: Y.Doc): string {
  return documentFingerprint(doc.getMap('meta').toJSON(), doc.getArray<string>('fileOrder').toArray(),
    [...doc.getMap<Y.Map<unknown>>('files')].map(([id, f]) => ({ id, path: f.get('path') as string, language: f.get('language') as string,
      deletedAt: f.get('deletedAt') as number | null, code: (f.get('content') as Y.Text).toString() })), Y.encodeStateVector(doc))
}
export function readDocument(doc: Y.Doc, identity: Identity): { files: FileRecord[]; entryFileId: string; conflicts: string[] } {
  if ([...doc.share.keys()].some(k => !['meta', 'files', 'fileOrder'].includes(k))) throw new Error('无法识别的文档结构，已只读隔离')
  const meta = doc.getMap('meta'), files = doc.getMap('files'), order = doc.getArray<string>('fileOrder').toArray()
  if (meta.size !== 4 || meta.get('schemaVersion') !== 1 || meta.get('projectId') !== identity.projectId || meta.get('epoch') !== identity.epoch) throw new Error('文档版本或身份不匹配，已只读隔离')
  if (!files.size || files.size > LIMITS.files || order.length !== files.size || new Set(order).size !== order.length) throw new Error('文件数量或顺序无效')
  let total = 0
  const records = order.map(id => {
    const item = files.get(id)
    if (typeof id !== 'string' || !id || id.length > 100 || !(item instanceof Y.Map) || item.size !== 5 || item.get('id') !== id || !(item.get('content') instanceof Y.Text)) throw new Error('文件结构无效')
    const path = item.get('path'), language = item.get('language'), deletedAt = item.get('deletedAt'), content = item.get('content') as Y.Text
    if (typeof path !== 'string' || language !== validatePath(path) || (deletedAt !== null && (!Number.isSafeInteger(deletedAt) || Number(deletedAt) < 0))) throw new Error('文件元数据无效')
    if (content.toDelta().some((part: { insert?: unknown; attributes?: unknown }) => typeof part.insert !== 'string' || part.attributes)) throw new Error('文件包含非纯文本内容')
    const size = byteLength(content.toString()); total += size
    if (size > LIMITS.fileBytes || total > LIMITS.totalBytes) throw new Error('文件内容超出协作容量')
    return { id, path, language: language as string, content, deletedAt: deletedAt as number | null }
  })
  const entryFileId = meta.get('entryFileId')
  if (typeof entryFileId !== 'string' || !records.some(f => f.id === entryFileId && f.deletedAt === null)) throw new Error('入口文件无效')
  if (Y.encodeStateAsUpdate(doc).byteLength > LIMITS.documentBytes) throw new Error('文档超出协作容量')
  const active = records.filter(f => f.deletedAt === null), paths = resolvedPaths(active)
  return { files: active.map(f => ({ ...f, path: paths.get(f.id)! })), entryFileId,
    conflicts: active.filter(f => paths.get(f.id) !== f.path).map(f => `${f.path} → ${paths.get(f.id)}`) }
}
export function fileCommands(doc: Y.Doc, identity: Identity, writable: () => boolean) {
  const check = () => { if (!writable()) throw new Error('当前连接不可编辑'); return readDocument(doc, identity) }
  const target = (id: string) => {
    const state = check(), file = state.files.find(f => f.id === id)
    if (!file) throw new Error('文件已删除')
    return { state, file, map: doc.getMap<Y.Map<unknown>>('files').get(id)! }
  }
  const available = (path: string, except?: string) => {
    if (check().files.some(f => f.path === path && f.id !== except)) throw new Error('该文件路径已存在')
  }
  return {
    create(value: string) {
      const path = normalizePath(value); available(path)
      if (doc.getMap('files').size >= LIMITS.files) throw new Error('文件数量已达上限（包含逻辑删除文件）')
      const id = crypto.randomUUID()
      doc.transact(() => {
        const file = new Y.Map<unknown>()
        file.set('id', id); file.set('path', path); file.set('language', validatePath(path)); file.set('deletedAt', null); file.set('content', new Y.Text())
        doc.getMap('files').set(id, file); doc.getArray<string>('fileOrder').push([id])
      }, STRUCTURE_ORIGIN)
      return id
    },
    rename(id: string, value: string) {
      const { map } = target(id), path = normalizePath(value); available(path, id)
      doc.transact(() => { map.set('path', path); map.set('language', validatePath(path)) }, STRUCTURE_ORIGIN)
    },
    remove(id: string) {
      const { state, map } = target(id)
      if (id === state.entryFileId) throw new Error('入口文件不能删除')
      doc.transact(() => map.set('deletedAt', Date.now()), STRUCTURE_ORIGIN)
    },
    setEntry(id: string) { target(id); doc.transact(() => doc.getMap('meta').set('entryFileId', id), STRUCTURE_ORIGIN) },
  }
}
