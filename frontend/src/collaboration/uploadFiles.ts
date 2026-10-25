import { LIMITS, normalizePath } from './document'
import { normalizeDirectoryPath } from '../../../collaboration/src/directories'

export const UPLOAD_ACCEPT = '.html,.css,.js,.json,.txt,.md'

function readBytes(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(new Error(`无法读取文件：${file.name}`))
    reader.onabort = () => reject(new Error(`已取消读取文件：${file.name}`))
    reader.readAsArrayBuffer(file)
  })
}

/** 只接收 UTF-8 文本；读取完成后由协作命令再次检查最新文档与权限。 */
export async function readUploadFiles(files: File[], directory: string) {
  const parent = directory === '/' ? '' : normalizeDirectoryPath(directory)
  if (files.length > LIMITS.files) throw new Error('一次最多上传 100 个文件')
  let bytes = 0
  const paths = files.map((file) => {
    if (/[/\\]/u.test(file.name)) throw new Error(`文件名无效：${file.name}`)
    const path = normalizePath(`${parent}/${file.name}`)
    if (file.size > LIMITS.fileBytes) throw new Error(`${file.name} 超过单文件 1 MiB 限制`)
    bytes += file.size
    if (bytes > LIMITS.totalBytes) throw new Error('上传文件总大小超过 10 MiB 限制')
    return path
  })
  if (new Set(paths).size !== paths.length) throw new Error('所选文件存在同名文件')
  return Promise.all(
    files.map(async (file, index) => {
      const data = await readBytes(file)
      let code: string
      try {
        code = new TextDecoder('utf-8', { fatal: true }).decode(data)
      } catch {
        throw new Error(`${file.name} 不是有效的 UTF-8 文本文件`)
      }
      if (code.includes('\0')) throw new Error(`${file.name} 包含二进制内容，无法上传`)
      return { path: paths[index], code }
    }),
  )
}
