import * as Y from 'yjs'
import { randomUUID } from 'node:crypto'
import { documentFingerprint, LIMITS, resolvedPaths, validatePath } from './document-rules.js'
export { LIMITS, validatePath } from './document-rules.js'

export type FileInput = { path: string; code: string }
export type Identity = { projectId: number; epoch: number }
export function fingerprint(doc: Y.Doc): string {
  return documentFingerprint(doc.getMap('meta').toJSON(), doc.getArray<string>('fileOrder').toArray(),
    [...doc.getMap<Y.Map<unknown>>('files')].map(([id, f]) => ({ id, path: f.get('path') as string, language: f.get('language') as string,
      deletedAt: f.get('deletedAt') as number | null, code: (f.get('content') as Y.Text).toString() })), Y.encodeStateVector(doc))
}

/**
 * 在完整校验后按稳定文件 ID 归一化同路径冲突；其他无效结构仍拒绝。
 * @param doc 临时权威文档
 * @param expected 预期项目身份
 */
export function normalizeConflicts(doc: Y.Doc, expected: Identity): void {
  // Fully validate malformed inputs before repairing the one permitted conflict.
  validateDocument(doc, expected, true)
  const files = doc.getMap<Y.Map<unknown>>('files')
  const active = [...files].filter(([, f]) => f.get('deletedAt') === null).map(([id, f]) => ({ id, path: f.get('path') as string }))
  const paths = resolvedPaths(active)
  doc.transact(() => {
    for (const file of active) if (file.path !== paths.get(file.id)) files.get(file.id)!.set('path', paths.get(file.id)!)
  }, 'gateway-path-normalization')
  validateDocument(doc, expected)
}

/**
 * 要求项目 ID 和 epoch 为正的安全整数，防止文档身份无效。
 *
 * @param value 待校验或创建的项目 ID 和 epoch
 */
function identity(value: Identity): void {
  if (!Number.isSafeInteger(value.projectId) || value.projectId < 1 || !Number.isSafeInteger(value.epoch) || value.epoch < 1) throw new Error('Invalid document identity')
}

/**
 * 按入口及文件建立带独立文件 ID 的 Y.Doc，校验完整结构后返回；失败销毁临时文档。
 *
 * @param value 待校验或创建的项目 ID 和 epoch
 * @param entry 入口文件绝对路径
 * @param files 文件集合
 * @returns 经校验的新文档；使用结束后由调用方调用 destroy()
 */
export function createDocument(value: Identity, entry: string, files: FileInput[]): Y.Doc {
  identity(value)
  if (!Array.isArray(files) || !files.length || files.length > LIMITS.files) throw new Error('Invalid file count')
  const doc = new Y.Doc()
  try {
    doc.transact(() => {
      const meta = doc.getMap('meta'), map = doc.getMap('files'), order = doc.getArray<string>('fileOrder')
      meta.set('schemaVersion', 1); meta.set('projectId', value.projectId); meta.set('epoch', value.epoch)
      for (const input of files) {
        if (!input || typeof input.code !== 'string') throw new Error('Invalid file content')
        if (!input || typeof input.code !== 'string') throw new Error('Invalid file content')
        const id = randomUUID(), file = new Y.Map()
        file.set('id', id); file.set('path', input.path); file.set('language', validatePath(input.path))
        file.set('deletedAt', null); file.set('content', new Y.Text(input.code))
        map.set(id, file); order.push([id])
        if (input.path === entry) meta.set('entryFileId', id)
      }
    })
    validateDocument(doc, value)
    return doc
  } catch (error) { doc.destroy(); throw error }
}

/**
 * 校验根结构、项目身份、文件顺序及元数据、入口有效性和文本大小，拒绝富文本、重复有效路径及超限文档。
 *
 * @param doc Yjs 协作文档
 * @param expected 预期的项目 ID 和 epoch
 */
export function validateDocument(doc: Y.Doc, expected: Identity, allowPathConflicts = false): void {
  identity(expected)
  if ([...doc.share.keys()].some(key => !['meta', 'files', 'fileOrder'].includes(key))) throw new Error('Unknown document root')
  const meta = doc.getMap('meta'), files = doc.getMap('files'), order = doc.getArray<string>('fileOrder')
  if (meta.size !== 4 || meta.get('schemaVersion') !== 1 || meta.get('projectId') !== expected.projectId || meta.get('epoch') !== expected.epoch) throw new Error('Invalid document metadata')
  if (!files.size || files.size > LIMITS.files) throw new Error('Invalid file count')
  const ids = order.toArray()
  if (ids.length !== files.size || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !files.has(id))) throw new Error('Invalid file order')
  let total = 0
  const paths = new Set<string>()
  for (const [id, item] of files) {
    if (!id || id.length > 100 || !(item instanceof Y.Map) || item.size !== 5 || item.get('id') !== id || !(item.get('content') instanceof Y.Text)) throw new Error('Invalid file schema')
    const path = item.get('path'), deleted = item.get('deletedAt')
    if (typeof path !== 'string' || item.get('language') !== validatePath(path) || (deleted !== null && (!Number.isSafeInteger(deleted) || deleted < 0))) throw new Error('Invalid file metadata')
    if (deleted === null) {
      if (!allowPathConflicts && paths.has(path)) throw new Error('Duplicate file path')
      paths.add(path)
    }
    const content = item.get('content') as Y.Text
    if (content.toDelta().some((part: { insert?: unknown; attributes?: unknown }) => typeof part.insert !== 'string' || part.attributes)) throw new Error('File content must be plain text')
    const size = Buffer.byteLength(content.toString(), 'utf8')
    if (size > LIMITS.fileBytes || (total += size) > LIMITS.totalBytes) throw new Error('File size limit exceeded')
  }
  const entry = files.get(meta.get('entryFileId') as string)
  if (!(entry instanceof Y.Map) || entry.get('deletedAt') !== null) throw new Error('Entry file is missing or deleted')
  if (Y.encodeStateAsUpdate(doc).byteLength > LIMITS.documentBytes) throw new Error('Document size limit exceeded')
}

/**
 * 检查二进制大小并加载 Yjs 状态，验证预期身份和结构；失败销毁文档，成功后的文档由调用方释放。
 *
 * @param bytes 文档二进制内容
 * @param expected 预期的项目 ID 和 epoch
 * @returns 经身份和结构校验的文档；使用结束后由调用方调用 destroy()
 */
export function loadDocument(bytes: Uint8Array, expected: Identity): Y.Doc {
  if (!bytes.length || bytes.length > LIMITS.documentBytes) throw new Error('Document size limit exceeded')
  const doc = new Y.Doc()
  try { Y.applyUpdate(doc, bytes); validateDocument(doc, expected); return doc }
  catch (error) { doc.destroy(); throw error }
}

/**
 * 校验文档与预期身份后编码完整 Yjs 状态，而非仅编码增量更新。
 *
 * @param doc Yjs 协作文档
 * @param expected 预期的项目 ID 和 epoch
 * @returns 完整 Yjs 状态的二进制编码
 */
export function encodeDocument(doc: Y.Doc, expected: Identity): Uint8Array {
  validateDocument(doc, expected)
  return Y.encodeStateAsUpdate(doc)
}

/**
 * 读取源文档有效文件并重建为目标身份，生成全新文件 ID 和协作历史；始终销毁临时源文档。
 *
 * @param bytes 文档二进制内容
 * @param source 源文档的项目 ID 和 epoch
 * @param target 目标文档的项目 ID 和 epoch
 * @returns 具有目标身份和全新文件 ID 的文档；由调用方负责销毁
 */
export function copyDocument(bytes: Uint8Array, source: Identity, target: Identity): Y.Doc {
  const doc = loadDocument(bytes, source)
  try {
    const files = doc.getMap<Y.Map<unknown>>('files'), entryId = doc.getMap('meta').get('entryFileId') as string
    return createDocument(target, files.get(entryId)!.get('path') as string,
      doc.getArray<string>('fileOrder').toArray().filter(id => files.get(id)!.get('deletedAt') === null)
        .map(id => ({ path: files.get(id)!.get('path') as string, code: (files.get(id)!.get('content') as Y.Text).toString() })))
  } finally { doc.destroy() }
}
