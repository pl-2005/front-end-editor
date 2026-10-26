import DOMPurify from 'dompurify'
import { serialize, type DefaultTreeAdapterMap } from 'parse5'
import type { SourceRegistry } from '../source/registry'
import { safeImageUrl, sanitizeCss, stylesheetPath } from './css'

export interface CanvasFile {
  path: string
  language: string
  source: string
}
export interface CanvasProjection {
  srcdoc: string
  capability: string
  registry: SourceRegistry
  issues: string[]
}
export const MARKER = 'data-editor-node'
const tags =
  'html head body title div span p h1 h2 h3 h4 h5 h6 section article aside main header footer nav address blockquote pre code em strong b i u s small sub sup br hr a img button form label input textarea fieldset legend ul ol li dl dt dd table caption colgroup col thead tbody tfoot tr th td details summary figure figcaption'.split(
    ' ',
  )

// Runs in an opaque sandbox; user data is encoded as JSON, never executable source.
function bridge(config: {
  capability: string
  fileId: string
  generation: string
  css: string[]
  marker: string
}) {
  for (const text of config.css) {
    const style = document.createElement('style')
    style.textContent = text
    document.head.append(style)
  }
  let port: MessagePort | undefined
  let selected: Element | null = null
  let connected = false
  let hovered: Element | null = null
  let pending = 0
  let lastHover = ''
  const reportNode = (element: Element | null, type: 'select' | 'hover') => {
    if (!element || !port) return
    const r = element.getBoundingClientRect()
    const message = {
      type,
      fileId: config.fileId,
      generation: config.generation,
      nodeId: element.getAttribute(config.marker),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    }
    if (type === 'hover') {
      const signature = JSON.stringify(message)
      if (signature === lastHover) return
      lastHover = signature
    }
    port.postMessage(message)
  }
  const report = () => {
    pending = 0
    reportNode(hovered, 'hover')
    reportNode(selected, 'select')
  }
  const schedule = () => {
    if (!pending) pending = requestAnimationFrame(report)
  }
  const clearHover = () => {
    hovered = null
    lastHover = ''
    cancelAnimationFrame(pending)
    pending = 0
    port?.postMessage({ type: 'clear-hover', fileId: config.fileId, generation: config.generation })
  }
  const hit = (target: EventTarget | null) =>
    target instanceof Element ? target.closest(`[${config.marker}]`) : null
  document.addEventListener('pointermove', (event) => {
    hovered = hit(event.target)
    if (hovered) schedule()
    else clearHover()
  })
  document.documentElement.addEventListener('pointerleave', clearHover)
  window.addEventListener('blur', clearHover)
  window.addEventListener('pagehide', () => {
    clearHover()
    port?.close()
    port = undefined
  })
  window.addEventListener('message', (event) => {
    if (
      connected ||
      event.source !== parent ||
      event.data?.type !== 'connect' ||
      event.data?.capability !== config.capability ||
      event.data?.generation !== config.generation ||
      event.ports.length !== 1
    )
      return
    connected = true
    port = event.ports[0]
    port.onmessage = (event) => {
      if (event.data?.type === 'parent') {
        selected = selected?.parentElement?.closest(`[${config.marker}]`) ?? null
        reportNode(selected, 'select')
      } else if (event.data?.type === 'refresh') schedule()
      else if (event.data?.type === 'clear-hover') clearHover()
    }
    port.start()
    port.postMessage({ type: 'ready', fileId: config.fileId, generation: config.generation })
  })
  document.addEventListener(
    'click',
    (event) => {
      event.preventDefault()
      event.stopPropagation()
      selected = hit(event.target)
      reportNode(selected, 'select')
    },
    true,
  )
  document.addEventListener('submit', (event) => event.preventDefault(), true)
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') clearHover()
      if (event.key === 'Enter' || event.key === ' ') event.preventDefault()
    },
    true,
  )
  window.addEventListener('scroll', schedule, true)
  window.addEventListener('resize', schedule)
  new ResizeObserver(schedule).observe(document.documentElement)
  parent.postMessage(
    {
      type: 'hello',
      capability: config.capability,
      generation: config.generation,
      fileId: config.fileId,
    },
    '*',
  )
}

export function createProjection(registry: SourceRegistry, files: CanvasFile[]): CanvasProjection {
  const issues = [...registry.issues]
  const css: string[] = []
  let cssBytes = 0
  let links = 0
  const addCss = (source: string, inline = false) => {
    cssBytes += new TextEncoder().encode(source).length
    if (cssBytes > 1024 * 1024) throw new Error('CSS 总量超过 1 MiB，设计预览暂停。')
    return sanitizeCss(source, issues, inline)
  }
  // Extract styles and remove resource/execution entry points in the inert parse5
  // tree before passing any user markup to a browser DOM parser.
  const elements = [...registry.identities].filter(([node]) => 'tagName' in node)
  const styles = elements
    .filter(([node]) => 'tagName' in node && ['style', 'link'].includes(node.tagName))
    .sort(
      ([, a], [, b]) =>
        (registry.nodes.get(a)?.startTag?.start ?? 0) -
        (registry.nodes.get(b)?.startTag?.start ?? 0),
    )
  for (const [node] of styles) {
    if (!('tagName' in node)) continue
    const attr = (name: string) => node.attrs.find((attr) => attr.name === name)?.value
    if (node.tagName === 'style') {
      const text = node.childNodes.map((child) => ('value' in child ? child.value : '')).join('')
      const media = attr('media')
      css.push(addCss(media ? `@media ${media}{${text}}` : text))
    } else if (attr('rel')?.toLowerCase().split(/\s+/).includes('stylesheet')) {
      if (++links > 32) throw new Error('样式引用超过 32 个，设计预览暂停。')
      const href = attr('href') ?? ''
      const path = stylesheetPath(registry.path, href)
      const file = files.find((file) => file.path === path && file.language === 'css')
      if (!file || attr('disabled') !== undefined || attr('title') !== undefined)
        issues.push(`样式资源未加载：${href.slice(0, 160)}（仅支持项目内直接 CSS）`)
      else {
        const media = attr('media')
        css.push(addCss(media ? `@media ${media}{${file.source}}` : file.source))
      }
    }
  }
  const allowedAttrs = new Set([
    'id',
    'class',
    'title',
    'alt',
    'src',
    'style',
    'type',
    'disabled',
    'value',
    'placeholder',
    'for',
    'colspan',
    'rowspan',
    'width',
    'height',
    'open',
    'dir',
    'lang',
  ])
  for (const [node, id] of elements) {
    if (!('tagName' in node)) continue
    if (!tags.includes(node.tagName) && !['style', 'link'].includes(node.tagName))
      issues.push('设计副本已移除脚本、嵌入页面及不支持的标签；原文保留。')
    node.attrs = node.attrs.filter((attr) => {
      if (attr.name.startsWith('on')) issues.push('设计副本已移除事件属性；原文保留。')
      if (attr.name === 'src') {
        if (node.tagName !== 'img' || !safeImageUrl(attr.value)) {
          issues.push('图片地址未支持，仅支持明确的 HTTP(S) 地址。')
          return false
        }
      }
      return !attr.namespace && (allowedAttrs.has(attr.name) || /^aria-[a-z-]+$/.test(attr.name))
    })
    for (const attr of node.attrs) if (attr.name === 'style') attr.value = addCss(attr.value, true)
    if (node.tagName === 'button') {
      node.attrs = node.attrs.filter((attr) => attr.name !== 'type')
      node.attrs.push({ name: 'type', value: 'button' })
    }
    if (['input', 'textarea'].includes(node.tagName))
      node.attrs.push({ name: 'disabled', value: '' })
    node.attrs.push({ name: MARKER, value: id })
  }
  const strip = (node: DefaultTreeAdapterMap['parentNode']) => {
    node.childNodes = node.childNodes.filter(
      (child) =>
        !('tagName' in child) ||
        (child.namespaceURI === 'http://www.w3.org/1999/xhtml' && tags.includes(child.tagName)),
    )
    for (const child of node.childNodes) if ('childNodes' in child) strip(child)
  }
  strip(registry.tree)
  const clean = DOMPurify.sanitize(serialize(registry.tree), {
    WHOLE_DOCUMENT: true,
    ALLOWED_TAGS: tags,
    ALLOWED_ATTR: [
      'id',
      'class',
      'title',
      'alt',
      'src',
      'style',
      'type',
      'disabled',
      'value',
      'placeholder',
      'for',
      'colspan',
      'rowspan',
      'width',
      'height',
      'open',
      'dir',
      'lang',
      MARKER,
    ],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
  })
  const output = new DOMParser().parseFromString(clean, 'text/html')
  const capability = crypto.randomUUID()
  const nonce = crypto.randomUUID()
  const config = JSON.stringify({
    capability,
    fileId: registry.fileId,
    generation: registry.generation,
    css,
    marker: MARKER,
  }).replace(/</g, '\\u003c')
  const csp = output.createElement('meta')
  csp.httpEquiv = 'Content-Security-Policy'
  csp.content = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src http: https:; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'`
  output.head.prepend(csp)
  const referrer = output.createElement('meta')
  referrer.name = 'referrer'
  referrer.content = 'no-referrer'
  output.head.append(referrer)
  const script = output.createElement('script')
  script.setAttribute('nonce', nonce)
  script.textContent = `(${bridge.toString()})(${config})`
  output.body.append(script)
  return {
    srcdoc: '<!doctype html>' + output.documentElement.outerHTML,
    capability,
    registry,
    issues: [...new Set(issues)],
  }
}
