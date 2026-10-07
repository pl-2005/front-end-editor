import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createProjectArchive } from './projectArchive'

describe('project ZIP export', () => {
  it('includes explicit empty directories', () => {
    const archive = createProjectArchive(
      'demo',
      [{ path: '/index.html', code: '' }],
      [],
      ['/empty/nested'],
    )
    const entries = unzipSync(archive.bytes)
    expect(entries['demo/empty/']).toHaveLength(0)
    expect(entries['demo/empty/nested/']).toHaveLength(0)
  })
  it('extracts into the project directory with original paths and UTF-8 contents', () => {
    const archive = createProjectArchive('我的项目', [
      { path: '/index.html', code: '<h1>你好</h1>' },
      { path: '/src/components/main.js', code: 'console.log("hello")' },
      { path: '/styles/empty.css', code: '' },
    ])
    const entries = unzipSync(archive.bytes)
    expect(archive.filename).toBe('我的项目.zip')
    expect(Object.keys(entries)).toEqual([
      '我的项目/',
      '我的项目/index.html',
      '我的项目/src/',
      '我的项目/src/components/',
      '我的项目/src/components/main.js',
      '我的项目/styles/',
      '我的项目/styles/empty.css',
    ])
    expect(strFromU8(entries['我的项目/index.html'])).toBe('<h1>你好</h1>')
    expect(strFromU8(entries['我的项目/src/components/main.js'])).toBe('console.log("hello")')
    expect(entries['我的项目/styles/empty.css']).toHaveLength(0)
  })

  it('preserves deleted-file recoveries without overwriting project files or each other', () => {
    const archive = createProjectArchive(
      'demo',
      [{ path: '/_recoveries/a.js', code: 'active' }],
      [
        { path: '/src/a.js', code: 'first recovery' },
        { path: '/src/a.js', code: 'second recovery' },
      ],
    )
    const entries = unzipSync(archive.bytes)
    expect(strFromU8(entries['demo/_recoveries/a.js'])).toBe('active')
    expect(strFromU8(entries['demo/_recoveries_/1/src/a.js'])).toBe('first recovery')
    expect(strFromU8(entries['demo/_recoveries_/2/src/a.js'])).toBe('second recovery')
  })

  it('sanitizes project names and rejects paths escaping the project directory', () => {
    expect(createProjectArchive('../demo: test.', []).filename).toBe('.._demo_ test.zip')
    expect(createProjectArchive('..', []).filename).toBe('project.zip')
    expect(() => createProjectArchive('demo', [{ path: '/../outside.js', code: '' }])).toThrow(
      '文件路径无效',
    )
  })
})
