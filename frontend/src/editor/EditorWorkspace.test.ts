import { describe, expect, it } from 'vitest'
import { prepareSandpackFiles, restoreUnchangedRuntimeFiles } from './sandpackRuntime'

describe('prepareSandpackFiles', () => {
  it('adds an explicit UTF-8 charset to legacy HTML fragments', () => {
    const files = {
      '/index.html': { code: '<h1>开始创作你的页面</h1>' },
    }

    expect(prepareSandpackFiles(files)['/index.html']?.code).toBe(
      '<meta charset="UTF-8">\n<h1>开始创作你的页面</h1>',
    )
  })

  it('preserves an existing HTML charset', () => {
    const files = {
      '/index.html': { code: '<head><meta charset="gb18030"></head><body>中文</body>' },
    }

    expect(prepareSandpackFiles(files)).toBe(files)
  })

  it('adds a Vite dev command to a generated package file', () => {
    const files = {
      '/index.js': { code: 'document.querySelector("#action")?.remove()' },
      '/package.json': { code: JSON.stringify({ dependencies: {}, main: '/index.js' }) },
    }

    const packageJson = JSON.parse(prepareSandpackFiles(files)['/package.json']?.code ?? '{}')
    expect(packageJson.scripts.dev).toBe('vite')
    expect(packageJson.devDependencies.vite).toBe('4.1.4')
  })

  it('preserves a user-managed package file', () => {
    const files = {
      '/index.js': { code: '' },
      '/package.json': { code: JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '^7.0.0' } }) },
    }

    expect(prepareSandpackFiles(files)).toBe(files)
  })

  it('migrates the unsupported Nodebox host command', () => {
    const files = {
      '/package.json': { code: JSON.stringify({ scripts: { dev: 'vite --host 0.0.0.0' }, devDependencies: { vite: '4.1.4' } }) },
    }

    const packageJson = JSON.parse(prepareSandpackFiles(files)['/package.json']?.code ?? '{}')
    expect(packageJson.scripts.dev).toBe('vite')
  })

  it('keeps optional chaining and local CSS imports intact for Vite', () => {
    const files = {
      '/index.html': { code: '<html><head></head><body><script type="module" src="/index.js"></script></body></html>' },
      '/index.js': { code: 'import "./styles.css";\ndocument.querySelector("#action")?.remove()' },
      '/styles.css': { code: 'body { color: red; }' },
    }

    const prepared = prepareSandpackFiles(files)

    expect(prepared['/index.js']?.code).toContain('import "./styles.css"')
    expect(prepared['/index.js']?.code).toContain('?.remove()')
  })

  it('does not persist unchanged runtime-only file transformations', () => {
    const source = {
      '/index.html': { code: '<h1>你好</h1>' },
      '/package.json': { code: JSON.stringify({ dependencies: {}, main: '/index.js' }) },
    }
    const runtime = prepareSandpackFiles(source)

    expect(restoreUnchangedRuntimeFiles(runtime, source)).toEqual(source)
  })

  it('preserves authored edits while restoring untouched runtime files', () => {
    const source = {
      '/index.html': { code: '<h1>你好</h1>' },
      '/index.js': { code: 'console.log("source")' },
    }
    const runtime = prepareSandpackFiles(source)
    const current = { ...runtime, '/index.js': { code: 'console.log("edited")' } }

    expect(restoreUnchangedRuntimeFiles(current, source)).toEqual({
      '/index.html': source['/index.html'],
      '/index.js': { code: 'console.log("edited")' },
    })
  })
})
