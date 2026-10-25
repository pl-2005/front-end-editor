import { describe, expect, it } from 'vitest'
import { readUploadFiles } from './uploadFiles'

describe('readUploadFiles', () => {
  it('reads UTF-8 text and empty files into normalized paths', async () => {
    await expect(
      readUploadFiles(
        [new File(['\ufeff你好\r\n'], 'hello.md'), new File([], 'empty.txt')],
        '/src',
      ),
    ).resolves.toEqual([
      { path: '/src/hello.md', code: '你好\r\n' },
      { path: '/src/empty.txt', code: '' },
    ])
  })

  it('rejects unsupported types, duplicate names, traversal, oversize and excessive file counts', async () => {
    for (const files of [
      [new File(['x'], 'image.png')],
      [new File(['x'], '../escape.js')],
      [new File([], 'same.js'), new File([], 'same.js')],
      [new File([new Uint8Array(1024 * 1024 + 1)], 'big.txt')],
      Array.from({ length: 101 }, (_, i) => new File([], `${i}.txt`)),
      Array.from({ length: 11 }, (_, i) => new File([new Uint8Array(1024 * 1024)], `${i}.txt`)),
    ])
      await expect(readUploadFiles(files, '/')).rejects.toThrow()
  })

  it('rejects malformed UTF-8 and binary content instead of silently corrupting text', async () => {
    await expect(
      readUploadFiles([new File([new Uint8Array([0xff])], 'bad.txt')], '/'),
    ).rejects.toThrow('UTF-8')
    await expect(readUploadFiles([new File(['a\0b'], 'binary.txt')], '/')).rejects.toThrow('二进制')
  })
})
