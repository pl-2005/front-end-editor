import type { ProjectFiles } from '../types/project'

const VITE_DEV_COMMAND = 'vite --clearScreen false'
const VITE_VERSION = '4.1.4'
const ESBUILD_WASM_VERSION = '0.17.12'

/**
 * 仅在缺少字符集声明时向 HTML 补入 UTF-8 meta，保证预览中文正常显示。
 *
 * @param code 待处理的文件文本
 */
function ensureUtf8Charset(code: string): string {
  if (/<meta\s+[^>]*charset\s*=/i.test(code)) return code

  const head = /<head(?:\s[^>]*)?>/i
  if (head.test(code))
    return code.replace(head, (openingTag) => `${openingTag}\n  <meta charset="UTF-8">`)

  const html = /<html(?:\s[^>]*)?>/i
  if (html.test(code))
    return code.replace(
      html,
      (openingTag) => `${openingTag}\n<head>\n  <meta charset="UTF-8">\n</head>`,
    )

  return `<meta charset="UTF-8">\n${code}`
}

/**
 * 补齐 Vite 运行依赖并禁用 Nodebox 不支持的终端清屏，解析失败时保留原内容。
 *
 * @param code 待处理的文件文本
 */
function ensureViteDevCommand(code: string): string {
  try {
    const packageJson = JSON.parse(code) as Record<string, unknown>
    const scripts =
      typeof packageJson.scripts === 'object' && packageJson.scripts !== null
        ? (packageJson.scripts as Record<string, unknown>)
        : {}
    const hasCompatibleCommand =
      (typeof scripts.dev === 'string' && scripts.dev !== 'vite --host 0.0.0.0') ||
      typeof scripts.start === 'string'
    if (hasCompatibleCommand) {
      const runtimeScripts = { ...scripts }
      for (const name of ['dev', 'start']) {
        const command = scripts[name]
        if (typeof command !== 'string' || !/^vite(?:\s|$)/.test(command)) continue
        // Only adjust direct Vite commands; leave user-managed shell scripts intact.
        if (/[;&|\n\r]/.test(command)) continue
        runtimeScripts[name] = /--clearScreen(?:\s|=)/.test(command)
          ? command.replace(/--clearScreen(?:\s+|=)(true|false)\b/g, '--clearScreen false')
          : `${command} --clearScreen false`
      }
      if (runtimeScripts.dev === scripts.dev && runtimeScripts.start === scripts.start) return code
      return JSON.stringify({ ...packageJson, scripts: runtimeScripts }, null, 2)
    }

    const devDependencies =
      typeof packageJson.devDependencies === 'object' && packageJson.devDependencies !== null
        ? (packageJson.devDependencies as Record<string, unknown>)
        : {}
    return JSON.stringify(
      {
        ...packageJson,
        scripts: { ...scripts, dev: VITE_DEV_COMMAND },
        devDependencies: {
          ...devDependencies,
          vite: devDependencies.vite ?? VITE_VERSION,
          'esbuild-wasm': devDependencies['esbuild-wasm'] ?? ESBUILD_WASM_VERSION,
        },
      },
      null,
      2,
    )
  } catch {
    return code
  }
}

/**
 * 为预览临时补齐 HTML 字符集及 Vite 配置；未发生修改时复用原文件集合。
 *
 * @param files 文件集合
 */
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

/**
 * 将仅包含运行时补丁且未被用户编辑的内容还原为源文件，避免保存预览专用修改。
 *
 * @param currentFiles 编辑器当前文件集合
 * @param sourceFiles 持久化源文件集合
 */
export function restoreUnchangedRuntimeFiles(
  currentFiles: ProjectFiles,
  sourceFiles: ProjectFiles,
): ProjectFiles {
  const preparedSourceFiles = prepareSandpackFiles(sourceFiles)
  return Object.fromEntries(
    Object.entries(currentFiles).map(([path, currentFile]) => {
      const sourceFile = sourceFiles[path]
      const preparedFile = preparedSourceFiles[path]
      return [
        path,
        sourceFile && preparedFile?.code === currentFile.code ? sourceFile : currentFile,
      ]
    }),
  )
}
