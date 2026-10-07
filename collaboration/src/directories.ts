import * as Y from 'yjs'
import { LIMITS } from './document-rules.js'

/** Explicit directories are optional, so existing schema-v1 documents remain valid. */
export function normalizeDirectoryPath(value: string): string {
  const path = value.trim().normalize('NFKC').replaceAll('\\', '/').replace(/\/+$/, '')
  const absolute = path.startsWith('/') ? path : `/${path}`
  validateDirectoryPath(absolute)
  return absolute
}

export function validateDirectoryPath(path: string): void {
  if (path !== path.normalize('NFKC') || path.length > 255 || !path.startsWith('/')
    || /[\\\u0000-\u001f\u007f<>:"|?*]/u.test(path)
    || path.slice(1).split('/').some(part => !part.trim() || part === '.' || part === '..'))
    throw new Error('文件夹路径无效')
}

export function readDirectories(doc: Y.Doc): string[] {
  if (!doc.share.has('directories')) return []
  const directories = doc.getMap('directories')
  if (directories.size > LIMITS.directories)
    throw new Error('文件夹结构或数量无效')
  for (const [path, value] of directories) {
    validateDirectoryPath(path)
    if (value !== true) throw new Error('文件夹结构无效')
  }
  return [...directories.keys()].sort()
}

export function isWithin(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`)
}
