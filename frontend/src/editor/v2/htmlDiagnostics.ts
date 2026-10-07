import {
  getDefaultHTMLDataProvider,
  getLanguageService,
  TokenType,
} from 'vscode-html-languageservice'
export interface HtmlIssue {
  offset: number
  length: number
  message: string
}
const service = getLanguageService(),
  data = getDefaultHTMLDataProvider()
const knownTags = new Set(data.provideTags().map((t) => t.name))
const voidTags = new Set(
  'area base br col embed hr img input link meta param source track wbr'.split(' '),
)
const optionalTags = new Set(
  'html head body li dt dd p rt rp optgroup option colgroup thead tbody tfoot tr td th'.split(' '),
)
/** Bounded scanner diagnostics; HTML's optional end tags and custom elements are permitted. */
export function htmlDiagnostics(code: string): HtmlIssue[] {
  const scanner = service.createScanner(code),
    issues: HtmlIssue[] = [],
    stack: { name: string; offset: number }[] = []
  let tag = '',
    opening = false
  const attributes = new Set<string>()
  const add = (
    message: string,
    offset = scanner.getTokenOffset(),
    length = scanner.getTokenLength(),
  ) => {
    if (issues.length < 100) issues.push({ offset, length: Math.max(1, length), message })
  }
  for (let token = scanner.scan(); token !== TokenType.EOS; token = scanner.scan()) {
    if (scanner.getTokenError()) add(scanner.getTokenError()!)
    if (token === TokenType.StartTag) {
      tag = scanner.getTokenText().toLowerCase()
      opening = true
      attributes.clear()
      if (
        !knownTags.has(tag) &&
        !tag.includes('-') &&
        !['svg', 'path', 'g', 'circle', 'rect', 'math'].includes(tag)
      )
        add(`未知 HTML 标签：${tag}`)
      if (optionalTags.has(tag) && stack.at(-1)?.name === tag) stack.pop()
      if (!voidTags.has(tag)) stack.push({ name: tag, offset: scanner.getTokenOffset() })
    } else if (token === TokenType.EndTag) {
      opening = false
      const name = scanner.getTokenText().toLowerCase(),
        index = stack.map((t) => t.name).lastIndexOf(name)
      if (index < 0) add(`没有对应的开始标签：${name}`)
      else {
        for (const unclosed of stack.slice(index + 1))
          if (!optionalTags.has(unclosed.name))
            add(`标签未关闭：${unclosed.name}`, unclosed.offset, unclosed.name.length)
        stack.splice(index)
      }
    } else if (token === TokenType.AttributeName && opening) {
      const name = scanner.getTokenText().toLowerCase()
      if (attributes.has(name)) add(`重复属性：${name}`)
      attributes.add(name)
      if (
        knownTags.has(tag) &&
        !tag.includes('-') &&
        !name.startsWith('data-') &&
        !name.startsWith('aria-') &&
        !name.startsWith('on') &&
        !data.provideAttributes(tag).some((a) => a.name.toLowerCase() === name)
      )
        add(`未知 ${tag} 属性：${name}`)
    } else if (token === TokenType.StartTagSelfClose && opening && stack.at(-1)?.name === tag)
      stack.pop()
  }
  for (const unclosed of stack)
    if (!optionalTags.has(unclosed.name))
      add(`标签未关闭：${unclosed.name}`, unclosed.offset, unclosed.name.length)
  return issues
}
