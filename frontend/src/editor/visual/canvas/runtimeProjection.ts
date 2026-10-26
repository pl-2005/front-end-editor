import type { ProjectFiles } from '../../../types/project'
import type { FileRecord } from '../../../collaboration/document'
import { parseSource, type SourceRegistry } from '../source/registry'

// This script is installed once when the preview starts. Mode changes only send
// commands to it; they never change a Sandpack file or reload the running page.
function runtimeBridge(config: {
  capability: string
  fileId: string
  generation: string
  marker: string
}) {
  const tool = document.currentScript
  tool?.remove()
  let active = false
  let modeRevision = -1
  let disposed = false
  let port: MessagePort | undefined
  let selected: Element | null = null
  let hovered: Element | null = null
  let pending = 0
  let resizeObserver: ResizeObserver | undefined
  let mutationObserver: MutationObserver | undefined
  let cursorSheet: CSSStyleSheet | undefined
  const inspectionCursor = (enabled: boolean) => {
    // A preview-only sheet avoids changing user elements or their inline styles.
    if (typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in document)) return
    if (enabled && !cursorSheet) {
      cursorSheet = new CSSStyleSheet()
      cursorSheet.replaceSync(
        ':root, :root *, :root::before, :root::after, :root *::before, :root *::after { cursor: default !important; }',
      )
    }
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (sheet) => sheet !== cursorSheet,
    )
    if (enabled && cursorSheet)
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, cursorSheet]
  }
  const identities = new WeakMap<Element, string>()
  const ambiguous = new WeakSet<Element>()
  const last = new Map<string, string>()
  const emit = (element: Element | null, type: 'hover' | 'select') => {
    if (!active || !element || !port || !element.isConnected) return
    const rect = element.getBoundingClientRect()
    const message = {
      type,
      fileId: config.fileId,
      generation: config.generation,
      modeRevision,
      sourceStatus: identities.has(element)
        ? 'candidate'
        : ambiguous.has(element)
          ? 'ambiguous'
          : 'unmapped',
      sourceReason: identities.has(element)
        ? '运行节点仅与源码候选关联，尚未验证字段和结构。'
        : ambiguous.has(element)
          ? '多个运行节点携带相同来源标记。'
          : '运行节点没有可确认的静态来源。',
      nodeId: identities.get(element) ?? '',
      tag: element.tagName.toLowerCase(),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    }
    const signature = JSON.stringify(message)
    if (last.get(type) === signature) return
    last.set(type, signature)
    port.postMessage(message)
  }
  const refresh = () => {
    pending = 0
    if (hovered && !hovered.isConnected) clear()
    if (selected && !selected.isConnected) {
      selected = null
      last.delete('select')
      port?.postMessage({
        type: 'clear-selection',
        modeRevision,
        fileId: config.fileId,
        generation: config.generation,
      })
    }
    emit(hovered, 'hover')
    emit(selected, 'select')
    // CSS transforms can move targets without any resize or DOM mutation.
    schedule()
  }
  const schedule = () => {
    if (!disposed && active && (hovered || selected) && !pending)
      pending = requestAnimationFrame(refresh)
  }
  const clear = () => {
    hovered = null
    last.delete('hover')
    cancelAnimationFrame(pending)
    pending = 0
    port?.postMessage({
      type: 'clear-hover',
      modeRevision,
      fileId: config.fileId,
      generation: config.generation,
    })
    schedule()
  }
  const target = (event: Event) =>
    event.composedPath().find((node): node is Element => node instanceof Element) ??
    (event.target instanceof Element ? event.target : null)
  window.addEventListener(
    'pointermove',
    (event) => {
      if (!active) return
      hovered = target(event)
      schedule()
      event.stopImmediatePropagation()
    },
    true,
  )
  window.addEventListener(
    'click',
    (event) => {
      if (!active) return
      event.preventDefault()
      event.stopImmediatePropagation()
      selected = target(event)
      last.delete('select')
      emit(selected, 'select')
      schedule()
    },
    true,
  )
  // Prevent press handlers from changing the inspected page before click.
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'submit'])
    window.addEventListener(
      type,
      (event) => {
        if (active) {
          event.preventDefault()
          event.stopImmediatePropagation()
        }
      },
      true,
    )
  window.addEventListener(
    'keydown',
    (event) => {
      if (active && event.key === 'Escape') clear()
    },
    true,
  )
  window.addEventListener('blur', clear)
  window.addEventListener('scroll', schedule, true)
  window.addEventListener('resize', schedule)
  document.documentElement.addEventListener('pointerleave', clear)
  window.addEventListener('pagehide', () => {
    active = false
    inspectionCursor(false)
    disposed = true
    selected = null
    clear()
    resizeObserver?.disconnect()
    mutationObserver?.disconnect()
    port?.close()
    port = undefined
  })
  window.addEventListener('message', (event) => {
    if (
      port ||
      event.source !== parent ||
      event.data?.type !== 'runtime-connect' ||
      event.data.capability !== config.capability ||
      event.data.generation !== config.generation ||
      event.data.fileId !== config.fileId ||
      disposed ||
      event.ports.length !== 1
    )
      return
    port = event.ports[0]
    port.onmessage = ({ data }) => {
      if (
        data?.type === 'mode' &&
        typeof data.active === 'boolean' &&
        Number.isSafeInteger(data.modeRevision) &&
        data.modeRevision >= 0 &&
        data.modeRevision > modeRevision
      ) {
        modeRevision = data.modeRevision
        active = data.active
        inspectionCursor(active)
        selected = null
        clear()
        last.clear()
        port?.postMessage({
          type: 'mode-ready',
          modeRevision,
          fileId: config.fileId,
          generation: config.generation,
        })
      } else if (data?.modeRevision !== modeRevision) return
      else if (data?.type === 'clear-hover') clear()
      else if (data?.type === 'refresh') schedule()
      else if (data?.type === 'parent' && active) {
        selected = selected?.parentElement ?? selected
        last.delete('select')
        emit(selected, 'select')
        schedule()
      }
    }
    port.start()
    port.postMessage({ type: 'ready', fileId: config.fileId, generation: config.generation })
  })
  const initialize = () => {
    if (disposed) return
    const elements = [...document.querySelectorAll(`[${config.marker}]`)]
    const counts = new Map<string, number>()
    for (const element of elements) {
      const id = element.getAttribute(config.marker)!
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    for (const element of elements) {
      const id = element.getAttribute(config.marker)!
      // Even a unique copied marker remains only a candidate, never write authority.
      if (counts.get(id) === 1) identities.set(element, id)
      else ambiguous.add(element)
      element.removeAttribute(config.marker)
    }
    resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(document.documentElement)
    mutationObserver = new MutationObserver(schedule)
    mutationObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    })
    const announce = () => {
      if (disposed) return
      parent.postMessage(
        {
          type: 'runtime-hello',
          capability: config.capability,
          fileId: config.fileId,
          generation: config.generation,
        },
        '*',
      )
    }
    // Wait for load so the owner has discarded the previous document's channel.
    const loaded = () => {
      if (disposed) return
      port?.close()
      port = undefined
      active = false
      inspectionCursor(false)
      // The owner iframe's load handler runs after the child window's load.
      // Send hello in the next task so its old connection has been discarded.
      setTimeout(announce, 0)
    }
    if (document.readyState === 'complete') loaded()
    else window.addEventListener('load', loaded, { once: true })
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', initialize, { once: true })
  else initialize()
}

/** Preview-only instrumentation. The authoritative files and exports stay intact. */
export class RuntimeProjection {
  readonly capability = crypto.randomUUID()
  readonly marker = `data-inspect-${crypto.randomUUID()}`
  readonly registries = new Map<string, SourceRegistry>()
  private cache = new Map<string, { source: string; path: string; code: string }>()
  project(files: FileRecord[], prepared: ProjectFiles): ProjectFiles {
    const result = { ...prepared }
    const ids = new Set(files.map((file) => file.id))
    for (const id of this.cache.keys())
      if (!ids.has(id)) {
        this.cache.delete(id)
        this.registries.delete(id)
      }
    for (const file of files) {
      if (file.language !== 'html') {
        this.registries.delete(file.id)
        this.cache.delete(file.id)
        continue
      }
      const source = file.content.toString()
      const cached = this.cache.get(file.id)
      if (cached?.source === source && cached.path === file.path) {
        result[file.path] = { code: cached.code }
        continue
      }
      try {
        const registry = parseSource(file.id, file.path, source)
        // A tool placed before meta CSP would execute before the policy applies.
        // Leave such pages untouched; HTTP CSP is enforced normally by the browser.
        const hasMetaPolicy = [...registry.identities.keys()].some(
          (node) =>
            'tagName' in node &&
            node.tagName === 'meta' &&
            node.attrs.some(
              (attr) =>
                attr.name === 'http-equiv' &&
                attr.value.trim().toLowerCase() === 'content-security-policy',
            ),
        )
        if (hasMetaPolicy) throw new Error('Meta CSP: inspection unavailable')
        // Patch original start tags; never serialize or normalize user markup.
        const edits: { at: number; value: string }[] = []
        const starts = new Set<number>()
        for (const node of registry.nodes.values())
          if (node.startTag) {
            // Parser recovery can associate one start tag with several nodes.
            // Leave those nodes unmapped instead of inserting duplicate markers.
            if (starts.has(node.startTag.start)) throw new Error('Ambiguous source start tag')
            starts.add(node.startTag.start)
            // A trailing slash can belong to an unquoted attribute value.
            const name = /^<[^\s/>]+/.exec(source.slice(node.startTag.start, node.startTag.end))
            if (!name) throw new Error('Unsupported start tag')
            const at = node.startTag.start + name[0].length
            edits.push({ at, value: ` ${this.marker}="${node.id}"` })
          }
        const config = JSON.stringify({
          capability: this.capability,
          fileId: file.id,
          generation: registry.generation,
          marker: this.marker,
        }).replace(/</g, '\\u003c')
        const script = `<script>(${runtimeBridge.toString()})(${config})</script>`
        const head = [...registry.nodes.values()].find(
          (node) => node.tag === 'head' && node.startTag,
        )
        const html = [...registry.nodes.values()].find(
          (node) => node.tag === 'html' && node.startTag,
        )
        const doctype = /^\s*<!doctype[^>]*>/i.exec(source)
        edits.push({
          at: head?.startTag?.end ?? html?.startTag?.end ?? doctype?.[0].length ?? 0,
          value: script,
        })
        let code = source
        for (const edit of edits.sort((a, b) => b.at - a.at))
          code = code.slice(0, edit.at) + edit.value + code.slice(edit.at)
        this.registries.set(file.id, registry)
        this.cache.set(file.id, { source, path: file.path, code })
        // Keep the existing charset patch, after source-position instrumentation.
        result[file.path] = { code }
      } catch {
        // Unsupported HTML keeps its normal preview, with no inspection bridge.
        this.registries.delete(file.id)
        this.cache.delete(file.id)
      }
    }
    return result
  }
}
