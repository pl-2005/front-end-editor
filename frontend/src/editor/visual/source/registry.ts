import { parse, type DefaultTreeAdapterMap } from 'parse5'

type Node = DefaultTreeAdapterMap['node']
export interface SourceRange {
  start: number
  end: number
}
export interface SourceNode {
  id: string
  tag: string
  parentId?: string
  children: string[]
  range?: SourceRange
  startTag?: SourceRange
  endTag?: SourceRange
  attributes: Record<string, SourceRange>
  text: SourceRange[]
  operations: ('text' | 'attributes' | 'structure')[]
  reason?: string
}
export interface SourceRegistry {
  fileId: string
  path: string
  source: string
  generation: string
  tree: DefaultTreeAdapterMap['document']
  nodes: Map<string, SourceNode>
  identities: Map<Node, string>
  issues: string[]
}
export const HTML_BYTES = 200 * 1024
const special = new Set(
  'head script style link meta title base ul ol li dl dt dd table tbody thead tfoot tr td th col colgroup caption select option optgroup template svg math'.split(
    ' ',
  ),
)
const voidTags = new Set(
  'area base br col embed hr img input link meta param source track wbr'.split(' '),
)
const range = (location: { startOffset: number; endOffset: number }): SourceRange => ({
  start: location.startOffset,
  end: location.endOffset,
})

export function parseSource(fileId: string, path: string, source: string): SourceRegistry {
  if (new TextEncoder().encode(source).length > HTML_BYTES)
    throw new Error('HTML 超过 200 KiB，请使用代码或运行模式。')
  const issues: string[] = []
  const errors: { startOffset: number; endOffset: number }[] = []
  const tree = parse(source, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => {
      if (error.code !== 'missing-doctype') errors.push(error)
    },
  })
  const registry: SourceRegistry = {
    fileId,
    path,
    source,
    generation: crypto.randomUUID(),
    tree,
    nodes: new Map(),
    identities: new Map(),
    issues,
  }
  const visit = (node: Node, parentId?: string, restricted = false) => {
    let nextParent = parentId
    let nextRestricted = restricted
    if ('tagName' in node) {
      const location = node.sourceCodeLocation
      const id = `${registry.generation}:${registry.nodes.size}`
      const item: SourceNode = {
        id,
        tag: node.tagName,
        parentId,
        children: [],
        attributes: {},
        text: [],
        operations: [],
      }
      if (location) {
        item.range = range(location)
        if (location.startTag) item.startTag = range(location.startTag)
        if (location.endTag) item.endTag = range(location.endTag)
        for (const [key, value] of Object.entries(location.attrs ?? {}))
          item.attributes[key] = range(value)
      }
      if (!location?.startTag) item.reason = '浏览器隐式补全节点，无法唯一定位源码。'
      else if (!voidTags.has(node.tagName) && !location.endTag)
        item.reason = '缺少明确结束标签，请在源码中处理。'
      else if (node.tagName === 'html') item.reason = '根元素仅支持源码编辑。'
      else if (
        restricted ||
        special.has(node.tagName) ||
        node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      )
        item.reason = '特殊结构仅支持源码编辑。'
      else if (
        errors.some(
          (e) => e.startOffset <= location.endOffset && e.endOffset >= location.startOffset,
        )
      )
        item.reason = '此范围存在 HTML 语法错误。'
      else if (parentId) {
        const parent = registry.nodes.get(parentId)
        if (
          parent?.range &&
          (location.startOffset < parent.range.start || location.endOffset > parent.range.end)
        )
          item.reason = '解析发生重排，源码关系不明确。'
      }
      if (!item.reason) item.operations = ['text', 'attributes', 'structure']
      registry.nodes.set(id, item)
      registry.identities.set(node, id)
      if (parentId) registry.nodes.get(parentId)?.children.push(id)
      nextParent = id
      nextRestricted =
        restricted ||
        special.has(node.tagName) ||
        node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
    } else if (node.nodeName === '#text' && node.sourceCodeLocation && parentId) {
      registry.nodes.get(parentId)?.text.push(range(node.sourceCodeLocation))
    }
    if ('childNodes' in node)
      for (const child of node.childNodes) visit(child, nextParent, nextRestricted)
  }
  visit(tree)
  // Reject foster parenting, crossing intervals, and adoption-agency recovery.
  // Browser order must agree with both source order and source containment.
  const readOnly = (item: SourceNode, reason: string) => {
    item.operations = []
    item.reason = reason
  }
  for (const [element, id] of registry.identities) {
    const item = registry.nodes.get(id)!
    if (item.children.length)
      item.operations = item.operations.filter((operation) => operation !== 'text')
    if (!('childNodes' in element) || !item.startTag) continue
    let cursor = item.startTag.end
    let previous: Node | undefined
    for (const child of element.childNodes) {
      const location = child.sourceCodeLocation
      if (!location) continue
      if (
        location.startOffset < cursor ||
        location.endOffset > (item.endTag?.start ?? item.range!.end)
      ) {
        readOnly(item, '解析发生重排或范围交叉，源码关系不明确。')
        const previousId = previous && registry.identities.get(previous)
        if (previousId)
          readOnly(registry.nodes.get(previousId)!, '解析发生重排或范围交叉，源码关系不明确。')
        const childId = registry.identities.get(child)
        if (childId)
          readOnly(registry.nodes.get(childId)!, '解析发生重排或范围交叉，源码关系不明确。')
      }
      cursor = Math.max(cursor, location.endOffset)
      previous = child
    }
  }
  if (errors.length) issues.push('部分 HTML 存在语法错误，相关节点只读。')
  const starts = new Map<number, SourceNode[]>()
  for (const node of registry.nodes.values())
    if (node.startTag)
      starts.set(node.startTag.start, [...(starts.get(node.startTag.start) ?? []), node])
  for (const duplicates of starts.values())
    if (duplicates.length > 1)
      for (const node of duplicates) {
        node.operations = []
        node.reason = '源码位置对应多个解析节点。'
      }
  return registry
}
