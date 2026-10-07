import { strToU8, zipSync } from 'fflate'

interface ArchiveFile {
  path: string
  code: string
}

export function createProjectArchive(
  name: string,
  files: ArchiveFile[],
  recoveries: ArchiveFile[] = [],
  directories: string[] = [],
) {
  // Keep the project name as one portable directory component.
  const root =
    Array.from(name, (char) => (char.charCodeAt(0) < 32 ? '_' : char))
      .join('')
      .replace(/[<>:"/\\|?*]/g, '_')
      .trim()
      .replace(/[. ]+$/, '') || 'project'
  const entries: Record<string, Uint8Array> = Object.create(null)
  entries[`${root}/`] = new Uint8Array()
  const add = (path: string, code: string) => {
    const parts = path.replace(/^\/+/, '').split('/')
    if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\')))
      throw new Error('文件路径无效，无法导出')
    for (let i = 1; i < parts.length; i++)
      entries[`${root}/${parts.slice(0, i).join('/')}/`] = new Uint8Array()
    entries[`${root}/${parts.join('/')}`] = strToU8(code)
  }
  files.forEach((file) => add(file.path, file.code))
  directories.forEach((path) => {
    const parts = path.replace(/^\/+/, '').split('/')
    if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\')))
      throw new Error('文件夹路径无效，无法导出')
    for (let i = 1; i <= parts.length; i++)
      entries[`${root}/${parts.slice(0, i).join('/')}/`] = new Uint8Array()
  })
  if (recoveries.length) {
    let folder = '_recoveries'
    while (files.some((file) => file.path.replace(/^\/+/, '').split('/')[0] === folder))
      folder += '_'
    recoveries.forEach((file, index) =>
      add(`${folder}/${index + 1}/${file.path.replace(/^\/+/, '')}`, file.code),
    )
  }
  return { filename: `${root}.zip`, bytes: zipSync(entries, { level: 6 }) }
}
