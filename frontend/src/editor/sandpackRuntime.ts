import type { ProjectFiles } from '../types/project'

const VITE_DEV_COMMAND = 'vite'
const VITE_VERSION = '4.1.4'
const ESBUILD_WASM_VERSION = '0.17.12'

function ensureUtf8Charset(code: string): string {
  if (/<meta\s+[^>]*charset\s*=/i.test(code)) return code

  const head = /<head(?:\s[^>]*)?>/i
  if (head.test(code)) return code.replace(head, (openingTag) => `${openingTag}\n  <meta charset="UTF-8">`)

  const html = /<html(?:\s[^>]*)?>/i
  if (html.test(code)) return code.replace(html, (openingTag) => `${openingTag}\n<head>\n  <meta charset="UTF-8">\n</head>`)

  return `<meta charset="UTF-8">\n${code}`
}

function ensureViteDevCommand(code: string): string {
  try {
    const packageJson = JSON.parse(code) as Record<string, unknown>
    const scripts = typeof packageJson.scripts === 'object' && packageJson.scripts !== null
      ? packageJson.scripts as Record<string, unknown>
      : {}
    const hasCompatibleCommand = (typeof scripts.dev === 'string' && scripts.dev !== 'vite --host 0.0.0.0')
      || typeof scripts.start === 'string'
    if (hasCompatibleCommand) return code

    const devDependencies = typeof packageJson.devDependencies === 'object' && packageJson.devDependencies !== null
      ? packageJson.devDependencies as Record<string, unknown>
      : {}
    return JSON.stringify({
      ...packageJson,
      scripts: { ...scripts, dev: VITE_DEV_COMMAND },
      devDependencies: {
        ...devDependencies,
        vite: devDependencies.vite ?? VITE_VERSION,
        'esbuild-wasm': devDependencies['esbuild-wasm'] ?? ESBUILD_WASM_VERSION,
      },
    }, null, 2)
  } catch {
    return code
  }
}

export function prepareSandpackFiles(files: ProjectFiles): ProjectFiles {
  let changed = false
  const runtimeFiles: ProjectFiles = {}

  for (const [path, file] of Object.entries(files)) {
    const code = path.toLowerCase().endsWith('.html')
      ? ensureUtf8Charset(file.code)
      : path === '/package.json'
        ? ensureViteDevCommand(file.code)
        : file.code
    if (code !== file.code) changed = true
    runtimeFiles[path] = code === file.code ? file : { ...file, code }
  }

  return changed ? runtimeFiles : files
}
