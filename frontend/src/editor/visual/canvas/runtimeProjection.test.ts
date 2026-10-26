import { Script } from 'node:vm'
import { expect, it, vi } from 'vitest'
import * as Y from 'yjs'
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
  expect(first['/index.html'].code).toContain('<link rel="stylesheet" href="/a.css"')
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
    },
    MutationObserver: class {
      observe() {}
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
  port.onmessage!({ data: { type: 'mode', active: true } })
  expect(click().defaultPrevented).toBe(true)
  expect(port.postMessage.mock.calls.at(-1)![0]).toMatchObject({
    type: 'select',
    tag: 'p',
    nodeId: [...registry.nodes.values()].find((node) => node.tag === 'p')!.id,
  })
  const dynamic = doc.createElement('span')
  doc.body.append(dynamic)
  emit('click', dynamic)
  expect(port.postMessage.mock.calls.at(-1)![0]).toMatchObject({ nodeId: '', tag: 'span' })
  dynamic.remove()
  for (const active of [false, true, false]) port.onmessage!({ data: { type: 'mode', active } })
  expect(input.value).toBe('state persists')
  expect(doc.documentElement.outerHTML).toBe(source)
  expect(click().defaultPrevented).toBe(false)
  f.doc.destroy()
})
