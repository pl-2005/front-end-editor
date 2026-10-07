import * as Y from 'yjs'
import {
  isWithin,
  normalizeDirectoryPath,
  readDirectories,
} from '../../../collaboration/src/directories'
import { newFileContent } from '../editor/newFileContent'
import {
  documentFingerprint,
  LIMITS,
  normalizePath,
  resolvedPaths,
  validatePath,
} from '../../../collaboration/src/document-rules'
export { LIMITS, normalizePath }
export const STRUCTURE_ORIGIN = Symbol('local-file-command')
export interface FileRecord {
  id: string
  path: string
  language: string
  content: Y.Text
  deletedAt: number | null
}
export interface Identity {
  projectId: number
  epoch: number
}
const byteLength = (value: string) => new TextEncoder().encode(value).length
export function fingerprint(doc: Y.Doc): string {
  return documentFingerprint(
    doc.getMap('meta').toJSON(),
    doc.getArray<string>('fileOrder').toArray(),
    [...doc.getMap<Y.Map<unknown>>('files')].map(([id, f]) => ({
      id,
      path: f.get('path') as string,
      language: f.get('language') as string,
      deletedAt: f.get('deletedAt') as number | null,
      code: (f.get('content') as Y.Text).toString(),
    })),
    Y.encodeStateVector(doc),
    readDirectories(doc),
  )
}
export function readDocument(
  doc: Y.Doc,
  identity: Identity,
): { files: FileRecord[]; directories: string[]; entryFileId: string; conflicts: string[] } {
  if ([...doc.share.keys()].some((k) => !['meta', 'files', 'fileOrder', 'directories'].includes(k)))
    throw new Error('无法识别的文档结构，已只读隔离')
  const meta = doc.getMap('meta'),
    files = doc.getMap('files'),
    order = doc.getArray<string>('fileOrder').toArray()
  if (
    meta.size !== 4 ||
    meta.get('schemaVersion') !== 1 ||
    meta.get('projectId') !== identity.projectId ||
    meta.get('epoch') !== identity.epoch
  )
    throw new Error('文档版本或身份不匹配，已只读隔离')
  const directories = readDirectories(doc)
  if (
    !files.size ||
    files.size > LIMITS.files ||
    order.length !== files.size ||
    new Set(order).size !== order.length
  )
    throw new Error('文件数量或顺序无效')
  let total = 0
  const records = order.map((id) => {
    const item = files.get(id)
    if (
      typeof id !== 'string' ||
      !id ||
      id.length > 100 ||
      !(item instanceof Y.Map) ||
      item.size !== 5 ||
      item.get('id') !== id ||
      !(item.get('content') instanceof Y.Text)
    )
      throw new Error('文件结构无效')
    const path = item.get('path'),
      language = item.get('language'),
      deletedAt = item.get('deletedAt'),
      content = item.get('content') as Y.Text
    if (
      typeof path !== 'string' ||
      language !== validatePath(path) ||
      (deletedAt !== null && (!Number.isSafeInteger(deletedAt) || Number(deletedAt) < 0))
    )
      throw new Error('文件元数据无效')
    if (
      content
        .toDelta()
        .some(
          (part: { insert?: unknown; attributes?: unknown }) =>
            typeof part.insert !== 'string' || part.attributes,
        )
    )
      throw new Error('文件包含非纯文本内容')
    const size = byteLength(content.toString())
    total += size
    if (size > LIMITS.fileBytes || total > LIMITS.totalBytes)
      throw new Error('文件内容超出协作容量')
    return {
      id,
      path,
      language: language as string,
      content,
      deletedAt: deletedAt as number | null,
    }
  })
  const entryFileId = meta.get('entryFileId')
  if (
    typeof entryFileId !== 'string' ||
    !records.some((f) => f.id === entryFileId && f.deletedAt === null)
  )
    throw new Error('入口文件无效')
  if (Y.encodeStateAsUpdate(doc).byteLength > LIMITS.documentBytes)
    throw new Error('文档超出协作容量')
  const active = records.filter((f) => f.deletedAt === null),
    paths = resolvedPaths(active)
  return {
    directories,
    files: active.map((f) => ({ ...f, path: paths.get(f.id)! })),
    entryFileId,
    conflicts: active
      .filter((f) => paths.get(f.id) !== f.path)
      .map((f) => `${f.path} → ${paths.get(f.id)}`),
  }
}
export function fileCommands(doc: Y.Doc, identity: Identity, writable: () => boolean) {
  const check = () => {
    if (!writable()) throw new Error('当前连接不可编辑')
    return readDocument(doc, identity)
  }
  const target = (id: string) => {
    const state = check(),
      file = state.files.find((f) => f.id === id)
    if (!file) throw new Error('文件已删除')
    return { state, file, map: doc.getMap<Y.Map<unknown>>('files').get(id)! }
  }
  const available = (path: string, except?: string) => {
    const state = check()
    if (
      state.files.some(
        (f) => f.id !== except && (isWithin(f.path, path) || isWithin(path, f.path)),
      ) ||
      state.directories.some((directory) => isWithin(directory, path))
    )
      throw new Error('该文件路径已存在')
  }
  const directoryMap = () => doc.getMap<boolean>('directories')
  const directoryExists = (path: string, state = check()) =>
    state.directories.some((directory) => isWithin(directory, path)) ||
    state.files.some((file) => file.path.startsWith(`${path}/`))
  return {
    createDirectory(value: string) {
      const path = normalizeDirectoryPath(value),
        state = check()
      if (directoryExists(path, state) || state.files.some((file) => isWithin(path, file.path)))
        throw new Error('同名文件或文件夹已存在')
      if (state.directories.length >= LIMITS.directories) throw new Error('文件夹数量已达上限')
      doc.transact(() => directoryMap().set(path, true), STRUCTURE_ORIGIN)
    },
    /** 预先验证所有目标路径，再原子更新整棵子树，保留文件 ID 和内容。 */
    renamePath(from: string, value: string) {
      const state = check(),
        source = state.files.find((file) => file.path === from)
      const to = source ? normalizePath(value) : normalizeDirectoryPath(value)
      if (from === to) return
      if (!source && !directoryExists(from, state)) throw new Error('文件夹已删除')
      if (!source && isWithin(to, from)) throw new Error('不能将文件夹移动到自身或子目录')
      const moving = state.files.filter((file) =>
        source ? file.id === source.id : isWithin(file.path, from),
      )
      const explicit = state.directories.filter((directory) => !source && isWithin(directory, from))
      const nextFiles = moving.map((file) => ({ file, path: to + file.path.slice(from.length) }))
      const nextDirectories = explicit.map((path) => to + path.slice(from.length))
      if (!source && !nextDirectories.includes(to)) nextDirectories.push(to)
      const otherFiles = state.files.filter((file) => !moving.some((item) => item.id === file.id))
      const otherDirectories = state.directories.filter(
        (directory) => !explicit.includes(directory),
      )
      const oldParent = from.slice(0, from.lastIndexOf('/'))
      const retainedParent =
        oldParent &&
        oldParent !== to.slice(0, to.lastIndexOf('/')) &&
        !otherDirectories.includes(oldParent)
          ? oldParent
          : ''
      const destinations = [to, ...nextFiles.map((item) => item.path), ...nextDirectories]
      if (
        destinations.some((path) =>
          otherFiles.some((file) => isWithin(path, file.path) || isWithin(file.path, path)),
        ) ||
        otherDirectories.some((directory) => isWithin(directory, to))
      )
        throw new Error('目标位置已有同名文件或文件夹')
      nextFiles.forEach(({ path }) => normalizePath(path))
      nextDirectories.forEach((path) => normalizeDirectoryPath(path))
      if (
        otherDirectories.length + nextDirectories.length + Number(Boolean(retainedParent)) >
        LIMITS.directories
      )
        throw new Error('文件夹数量已达上限')
      doc.transact(() => {
        nextFiles.forEach(({ file, path }) => {
          const map = doc.getMap<Y.Map<unknown>>('files').get(file.id)!
          map.set('path', path)
          map.set('language', validatePath(path))
        })
        if (explicit.length || nextDirectories.length || retainedParent) {
          const directories = directoryMap()
          explicit.forEach((path) => directories.delete(path))
          nextDirectories.forEach((path) => directories.set(path, true))
          if (retainedParent) directories.set(retainedParent, true)
        }
      }, STRUCTURE_ORIGIN)
    },
    removePath(path: string) {
      const state = check(),
        source = state.files.find((file) => file.path === path)
      const removed = state.files.filter((file) =>
        source ? file.id === source.id : isWithin(file.path, path),
      )
      const directories = state.directories.filter(
        (directory) => !source && isWithin(directory, path),
      )
      if (!source && !directoryExists(path, state)) throw new Error('文件夹已删除')
      if (removed.some((file) => file.id === state.entryFileId))
        throw new Error('入口文件及其所在文件夹不能删除')
      const deletedAt = Date.now()
      const parent = path.slice(0, path.lastIndexOf('/'))
      const retainParent = parent && !state.directories.includes(parent)
      if (
        state.directories.length - directories.length + Number(Boolean(retainParent)) >
        LIMITS.directories
      )
        throw new Error('文件夹数量已达上限')
      doc.transact(() => {
        removed.forEach((file) =>
          doc.getMap<Y.Map<unknown>>('files').get(file.id)!.set('deletedAt', deletedAt),
        )
        directories.forEach((directory) => directoryMap().delete(directory))
        if (retainParent) directoryMap().set(parent, true)
      }, STRUCTURE_ORIGIN)
      return {
        files: removed.map((file) => ({ id: file.id, path: file.path, deletedAt })),
        directories,
      }
    },
    restore(receipt: {
      files: { id: string; path: string; deletedAt: number }[]
      directories: string[]
    }) {
      const state = check(),
        records = doc.getMap<Y.Map<unknown>>('files')
      for (const file of receipt.files) {
        const map = records.get(file.id)
        if (!map || map.get('deletedAt') !== file.deletedAt || map.get('path') !== file.path)
          throw new Error('文件已被其他操作修改，无法撤销此次删除')
        available(file.path)
      }
      for (const directory of receipt.directories)
        if (state.files.some((file) => isWithin(directory, file.path)))
          throw new Error('原目录已被文件占用，无法撤销')
      if (new Set([...state.directories, ...receipt.directories]).size > LIMITS.directories)
        throw new Error('文件夹数量已达上限')
      doc.transact(() => {
        receipt.files.forEach((file) => records.get(file.id)!.set('deletedAt', null))
        receipt.directories.forEach((path) => directoryMap().set(path, true))
      }, STRUCTURE_ORIGIN)
    },
    create(value: string) {
      const path = normalizePath(value)
      available(path)
      if (doc.getMap('files').size >= LIMITS.files)
        throw new Error('文件数量已达上限（包含逻辑删除文件）')
      const id = crypto.randomUUID()
      doc.transact(() => {
        const file = new Y.Map<unknown>()
        file.set('id', id)
        file.set('path', path)
        file.set('language', validatePath(path))
        file.set('deletedAt', null)
        file.set('content', new Y.Text(newFileContent(path)))
        doc.getMap('files').set(id, file)
        doc.getArray<string>('fileOrder').push([id])
      }, STRUCTURE_ORIGIN)
      return id
    },
    rename(id: string, value: string) {
      const { map } = target(id),
        path = normalizePath(value)
      available(path, id)
      doc.transact(() => {
        map.set('path', path)
        map.set('language', validatePath(path))
      }, STRUCTURE_ORIGIN)
    },
    remove(id: string) {
      const { state, map } = target(id)
      if (id === state.entryFileId) throw new Error('入口文件不能删除')
      doc.transact(() => map.set('deletedAt', Date.now()), STRUCTURE_ORIGIN)
    },
    setEntry(id: string) {
      target(id)
      doc.transact(() => doc.getMap('meta').set('entryFileId', id), STRUCTURE_ORIGIN)
    },
  }
}
