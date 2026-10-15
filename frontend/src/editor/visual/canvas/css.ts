import postcss from 'postcss'
import valueParser from 'postcss-value-parser'

export function safeImageUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}

export function sanitizeCss(source: string, issues: string[], inline = false): string {
  try {
    const root = postcss.parse(inline ? `x{${source}}` : source)
    root.walkAtRules((rule) => {
      if (['import', 'font-face', 'namespace', 'charset'].includes(rule.name.toLowerCase())) {
        issues.push(`CSS @${rule.name} 未支持，已从设计副本移除。`)
        rule.remove()
      } else if (
        !['media', 'supports', 'layer', 'container', 'keyframes', '-webkit-keyframes'].includes(
          rule.name.toLowerCase(),
        )
      ) {
        issues.push(`CSS @${rule.name} 未支持。`)
        rule.remove()
      } else if (
        rule.params.includes(String.fromCharCode(92)) ||
        /url\s*\(|image-set\s*\(/i.test(rule.params)
      ) {
        issues.push('CSS 条件中的资源已移除。')
        rule.remove()
      }
    })
    root.walkDecls((decl) => {
      let unsafe = /expression\s*\(|image-set\s*\(|-moz-binding|behavior/i.test(
        `${decl.prop}:${decl.value}`,
      )
      valueParser(decl.value).walk((node) => {
        if (
          node.type === 'function' &&
          (node.value.toLowerCase() === 'url' || node.value.includes(String.fromCharCode(92)))
        )
          unsafe = true
      })
      if (unsafe) {
        issues.push('CSS 资源 URL 或执行能力未支持，已移除该声明。')
        decl.remove()
      }
    })
    if (inline) {
      const first = root.first
      return first && 'nodes' in first
        ? (first.nodes?.map((node) => node.toString()).join(';') ?? '')
        : ''
    }
    return root.toString()
  } catch {
    issues.push('CSS 解析失败，该样式未加载。')
    return ''
  }
}

export function stylesheetPath(htmlPath: string, href: string): string | null {
  if (
    !href ||
    href.includes(String.fromCharCode(92)) ||
    [...href].some((char) => char.charCodeAt(0) <= 32) ||
    /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)
  )
    return null
  try {
    const url = new URL(href, `https://project.invalid${htmlPath}`)
    if (url.origin !== 'https://project.invalid' || url.search || url.hash) return null
    const path = decodeURIComponent(url.pathname)
    return path.includes(String.fromCharCode(92)) ||
      [...path].some((char) => char.charCodeAt(0) <= 32)
      ? null
      : path
  } catch {
    return null
  }
}
