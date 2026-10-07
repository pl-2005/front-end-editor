/** Protocol rules shared by the browser and the gateway. No Node APIs. */
export const LIMITS = Object.freeze({ files: 100, directories: 100, fileBytes: 1024 * 1024, totalBytes: 10 * 1024 * 1024, documentBytes: 12 * 1024 * 1024, updateBytes: 2 * 1024 * 1024 })
export const FILE_LANGUAGES: Readonly<Record<string, string>> = Object.freeze({ html: 'html', css: 'css', js: 'javascript', json: 'json', txt: 'plaintext', md: 'markdown' })
export function validatePath(path: string): string {
  if (typeof path !== 'string' || path !== path.normalize('NFKC') || path.length > 255 || !path.startsWith('/')
    || /[\\\u0000-\u001f\u007f]/u.test(path) || path.slice(1).split('/').some(p => !p.trim() || p === '.' || p === '..')) throw new Error('文件路径无效')
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (!Object.hasOwn(FILE_LANGUAGES, ext)) throw new Error('不支持的文件类型')
  return FILE_LANGUAGES[ext]
}
export function normalizePath(value: string): string {
  const path = value.trim().normalize('NFKC').replaceAll('\\', '/')
  const absolute = path.startsWith('/') ? path : `/${path}`
  validatePath(absolute)
  return absolute
}
/** Stable file ID wins the original path; suffixes preserve extensions and avoid existing paths. */
export function resolvedPaths(files: { id: string; path: string }[]): Map<string, string> {
  const result = new Map<string, string>(), occupied = new Set(files.map(f => f.path))
  const groups = new Map<string, { id: string; path: string }[]>()
  for (const file of files) groups.set(file.path, [...(groups.get(file.path) ?? []), file])
  for (const path of [...groups.keys()].sort()) {
    const group = groups.get(path)!.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    result.set(group[0].id, path)
    for (const file of group.slice(1)) {
      const dot = path.lastIndexOf('.'), extension = path.slice(dot)
      const suffix = [...file.id].map(c => c.charCodeAt(0).toString(16)).join('').slice(0, 40)
      let attempt = 0, candidate: string
      do {
        const tail = `~${suffix}${attempt ? `-${attempt}` : ''}${extension}`
        candidate = path.slice(0, Math.min(dot, 255 - tail.length)) + tail; attempt++
      } while (occupied.has(candidate))
      validatePath(candidate); occupied.add(candidate); result.set(file.id, candidate)
    }
  }
  return result
}
/** GC and undo retain different binary tombstones. Plain schema plus CRDT clocks
 * covers text deletes without confusing retained undo data with unsynced edits. */
export function documentFingerprint(meta: Record<string, unknown>, order: string[], files: { id: string; path: string; language: string; deletedAt: number | null; code: string }[], vector: Uint8Array, directories: string[] = []): string {
  return JSON.stringify({ meta: Object.keys(meta).sort().map(key => [key, meta[key]]), order, ...(directories.length ? { directories: [...directories].sort() } : {}),
    files: [...files].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(f => [f.id, f.path, f.language, f.deletedAt, f.code]), vector: [...vector] })
}
