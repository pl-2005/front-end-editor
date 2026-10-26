import { Script } from 'node:vm'
import { expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { RuntimeProjection } from './runtimeProjection'

function fixture() {
  const doc = new Y.Doc(),
    content = doc.getText('html')
  content.insert(
    0,
    '<!doctype html><html><head><link rel="stylesheet" href="/a.css"><style>p{color:red}</style></head><body><p id="a">中文😀 &amp;</p><input value="initial"><script>window.userScript=true</script></body></html>',
  )
  const file = { id: 'f', path: '/index.html', language: 'html', content, deletedAt: null }
  return { doc, file, files: { '/index.html': { code: content.toString() } } }
}
it('keeps preview instrumentation stable and preserves scripts, CSS and authoritative text', () => {
  const f = fixture(),
    projection = new RuntimeProjection()
  const first = projection.project([f.file], f.files)
  const second = projection.project([f.file], f.files)
  expect(second).toEqual(first)
  expect(projection.registries.get('f')!.source).toBe(f.file.content.toString())
  expect(first['/index.html'].code).toContain('window.userScript=true')
  expect(first['/index.html'].code).toContain('rel="stylesheet" href="/a.css"')
  expect(f.file.content.toString()).toBe(f.files['/index.html'].code)
  const generation = projection.registries.get('f')!.generation
  f.file.content.insert(0, '<!--change-->')
  projection.project([f.file], f.files)
  expect(projection.registries.get('f')!.generation).not.toBe(generation)
  projection.project([], {})
  expect(projection.registries.size).toBe(0)
  f.doc.destroy()
})
it('toggles inspection without changing DOM, values or styles and keeps dynamic nodes unmapped', () => {
  const f = fixture(),
    projection = new RuntimeProjection()
  const code = projection.project([f.file], f.files)['/index.html'].code
  const doc = new DOMParser().parseFromString(code, 'text/html')
  const tool = doc.querySelector('script')!
  Object.defineProperty(doc, 'currentScript', { value: tool })
  const win = new EventTarget(),
    parent = { postMessage: vi.fn() }
  const port = {
    postMessage: vi.fn(),
    start: vi.fn(),
    close: vi.fn(),
    onmessage: null as null | ((event: { data: unknown }) => void),
  }
  const frames = new Map<number, () => void>()
  let id = 0
  new Script(tool.textContent!).runInNewContext({
    document: doc,
    window: win,
    parent,
    Element,
    JSON,
    setTimeout: (callback: () => void) => {
      callback()
      return 0
    },
    requestAnimationFrame: (callback: () => void) => {
      frames.set(++id, callback)
      return id
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
  })
  expect(doc.documentElement.outerHTML).toBe(
    new DOMParser().parseFromString(f.file.content.toString(), 'text/html').documentElement
      .outerHTML,
  )
  const registry = projection.registries.get('f')!
  win.dispatchEvent(
    new MessageEvent('message', {
      source: parent as unknown as Window,
      data: {
        type: 'runtime-connect',
        capability: projection.capability,
        fileId: 'f',
        generation: registry.generation,
      },
      ports: [port as unknown as MessagePort],
    }),
  )
  const input = doc.querySelector('input')!
  input.value = 'state persists'
  const source = doc.documentElement.outerHTML
  const emit = (type: string, node: Element) => {
    const event = new Event(type, { cancelable: true })
    Object.defineProperty(event, 'target', { value: node })
    win.dispatchEvent(event)
    return event
  }
  const click = () => emit('click', doc.querySelector('p')!)
  expect(click().defaultPrevented).toBe(false)
  port.onmessage!({ data: { type: 'mode', active: true, modeRevision: 1 } })
  expect(click().defaultPrevented).toBe(true)
  expect(port.postMessage.mock.calls.at(-1)![0]).toMatchObject({
    type: 'select',
    sourceStatus: 'candidate',
    modeRevision: 1,
    tag: 'p',
    nodeId: [...registry.nodes.values()].find((node) => node.tag === 'p')!.id,
  })
  const dynamic = doc.createElement('span')
  doc.body.append(dynamic)
  emit('click', dynamic)
  expect(port.postMessage.mock.calls.at(-1)![0]).toMatchObject({ nodeId: '', tag: 'span' })
  dynamic.remove()
  for (const [i, active] of [false, true, false].entries())
    port.onmessage!({ data: { type: 'mode', active, modeRevision: i + 2 } })
  expect(input.value).toBe('state persists')
  expect(doc.documentElement.outerHTML).toBe(source)
  expect(click().defaultPrevented).toBe(false)
  f.doc.destroy()
})

it('preserves parsed attribute semantics including unquoted trailing slashes', () => {
  const f = fixture(),
    projection = new RuntimeProjection()
  const source =
    '<!doctype html><img src=/assets/x/><input value=x/ ><br/><div title="a>b">😀</div>'
  f.file.content.delete(0, f.file.content.length)
  f.file.content.insert(0, source)
  const code = projection.project([f.file], { '/index.html': { code: source } })['/index.html'].code
  const semantics = (html: string) => {
    const result: unknown[] = []
    const visit = (node: DefaultTreeAdapterMap['node']) => {
      if ('tagName' in node) {
        if (node.tagName === 'script') return
        result.push([
          node.tagName,
          node.attrs.filter((attr: { name: string }) => attr.name !== projection.marker),
        ])
      }
      if ('childNodes' in node) node.childNodes.forEach(visit)
    }
    visit(parse(html))
    return result
  }
  expect(semantics(code)).toEqual(semantics(source))
  expect(f.file.content.toString()).toBe(source)
  f.doc.destroy()
})

it('leaves meta CSP pages untouched instead of executing before their policy', () => {
  const f = fixture(),
    projection = new RuntimeProjection()
  const source =
    '<!doctype html><meta http-equiv="Content-Security-Policy" content="script-src \'none\'"><p>safe</p>'
  f.file.content.delete(0, f.file.content.length)
  f.file.content.insert(0, source)
  const prepared = { '/index.html': { code: source } }
  expect(projection.project([f.file], prepared)).toEqual(prepared)
  expect(projection.registries.size).toBe(0)
  f.doc.destroy()
})

it('declines ambiguous recovered source tags without changing the normal preview', () => {
  const f = fixture(),
    projection = new RuntimeProjection()
  // The adoption agency algorithm creates two b elements from one source tag.
  const source = '<!doctype html><p><b>one</p>two</b>'
  f.file.content.delete(0, f.file.content.length)
  f.file.content.insert(0, source)
  const prepared = { '/index.html': { code: source } }
  expect(projection.project([f.file], prepared)).toEqual(prepared)
  expect(projection.registries.size).toBe(0)
  f.doc.destroy()
})

function bridgeFixture(mutate?: (doc: Document) => void) {
  const f = fixture(),
    projection = new RuntimeProjection()
  const doc = new DOMParser().parseFromString(
    projection.project([f.file], f.files)['/index.html'].code,
    'text/html',
  )
  const tool = doc.querySelector('script')!
  Object.defineProperty(doc, 'currentScript', { value: tool })
  mutate?.(doc)
  const win = new EventTarget(),
    parent = { postMessage: vi.fn() }
  const port = {
    postMessage: vi.fn(),
    start: vi.fn(),
    close: vi.fn(),
    onmessage: null as null | ((event: { data: unknown }) => void),
  }
  const frames = new Map<number, () => void>()
  let frameId = 0
  new Script(tool.textContent!).runInNewContext({
    document: doc,
    window: win,
    parent,
    Element,
    JSON,
    setTimeout: (callback: () => void) => {
      callback()
      return 0
    },
    requestAnimationFrame: (callback: () => void) => {
      frames.set(++frameId, callback)
      return frameId
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
  })
  const registry = projection.registries.get('f')!
  win.dispatchEvent(
    new MessageEvent('message', {
      source: parent as unknown as Window,
      data: {
        type: 'runtime-connect',
        capability: projection.capability,
        fileId: 'f',
        generation: registry.generation,
      },
      ports: [port as unknown as MessagePort],
    }),
  )
  const command = (data: object) => port.onmessage!({ data })
  const mode = (active: boolean, modeRevision: number) =>
    command({ type: 'mode', active, modeRevision })
  const emit = (type: string, target: Element) => {
    const event = new Event(type, { cancelable: true })
    Object.defineProperty(event, 'target', { value: target })
    win.dispatchEvent(event)
    return event
  }
  const frame = () => {
    const queued = [...frames.values()]
    frames.clear()
    queued.forEach((callback) => callback())
  }
  return { ...f, ydoc: f.doc, doc, win, port, frames, command, mode, emit, frame }
}

it('treats pre-initialization cloning as ambiguous and unique replacement as candidate only', () => {
  for (const replace of [false, true]) {
    const f = bridgeFixture((doc) => {
      const original = doc.querySelector('p')!,
        clone = original.cloneNode(true)
      if (replace) original.replaceWith(clone)
      else original.after(clone)
    })
    f.mode(true, 1)
    f.emit('click', f.doc.querySelector('p')!)
    expect(f.port.postMessage.mock.calls.at(-1)![0]).toMatchObject({
      sourceStatus: replace ? 'candidate' : 'ambiguous',
      ...(replace ? {} : { nodeId: '' }),
    })
    f.ydoc.destroy()
  }
})

it('samples only active targets, deduplicates stationary frames and rejects old modes', () => {
  const f = bridgeFixture(),
    p = f.doc.querySelector('p')!
  let x = 0
  vi.spyOn(p, 'getBoundingClientRect').mockImplementation(
    () => ({ x, y: 0, width: 10, height: 20 }) as DOMRect,
  )
  f.mode(true, 1)
  expect(f.frames.size).toBe(0)
  f.emit('click', p)
  const calls = f.port.postMessage.mock.calls.length
  f.frame()
  expect(f.port.postMessage.mock.calls.length).toBe(calls)
  x = 42
  f.frame()
  expect(f.port.postMessage.mock.calls.at(-1)![0]).toMatchObject({
    type: 'select',
    rect: { x: 42 },
    modeRevision: 1,
  })
  expect(f.frames.size).toBe(1)
  f.mode(false, 3)
  expect(f.frames.size).toBe(0)
  f.mode(true, 3)
  expect(f.emit('click', p).defaultPrevented).toBe(false)
  f.mode(true, 2)
  expect(f.emit('click', p).defaultPrevented).toBe(false)
  f.mode(true, 4)
  f.emit('click', p)
  p.remove()
  f.frame()
  expect(f.port.postMessage.mock.calls.at(-1)![0]).toMatchObject({
    type: 'clear-selection',
    modeRevision: 4,
  })
  expect(f.frames.size).toBe(0)
  f.mode(true, 5)
  f.emit('click', f.doc.querySelector('input')!)
  f.win.dispatchEvent(new Event('pagehide'))
  expect(f.frames.size).toBe(0)
  expect(f.port.close).toHaveBeenCalled()
  f.ydoc.destroy()
})

it('keeps the selected root when there is no further DOM parent', () => {
  const f = bridgeFixture()
  f.mode(true, 1)
  f.emit('click', f.doc.documentElement)
  f.command({ type: 'parent', modeRevision: 1 })
  expect(f.port.postMessage.mock.calls.at(-1)![0]).toMatchObject({ type: 'select', tag: 'html' })
  f.ydoc.destroy()
})
