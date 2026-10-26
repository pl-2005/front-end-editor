import { Script } from 'node:vm'
import { expect, it, vi } from 'vitest'
import { parseSource } from '../source/registry'
import { createProjection } from './projection'

it('coalesces pointer checks, deduplicates geometry and cancels queued inspection on clear', () => {
  const projection = createProjection(
    parseSource(
      'f',
      '/index.html',
      '<html><head></head><body><main><p>A😀</p><p>B</p></main></body></html>',
    ),
    [],
  )
  const doc = new DOMParser().parseFromString(projection.srcdoc, 'text/html')
  const script = doc.querySelector('script')!.textContent!
  const win = new EventTarget()
  const parent = { postMessage: vi.fn() }
  const port = {
    postMessage: vi.fn(),
    start: vi.fn(),
    close: vi.fn(),
    onmessage: null as null | ((e: { data: unknown }) => void),
  }
  let next = 0
  const frames = new Map<number, () => void>()
  new Script(script).runInNewContext({
    document: doc,
    window: win,
    parent,
    Element,
    JSON,
    requestAnimationFrame: (fn: () => void) => {
      frames.set(++next, fn)
      return next
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    ResizeObserver: class {
      observe() {}
    },
  })
  win.dispatchEvent(
    new MessageEvent('message', {
      source: parent as unknown as Window,
      data: {
        type: 'connect',
        capability: projection.capability,
        generation: projection.registry.generation,
      },
      ports: [port as unknown as MessagePort],
    }),
  )
  const [a, b] = doc.querySelectorAll('p')
  const move = (node: Element) => node.dispatchEvent(new Event('pointermove', { bubbles: true }))
  const flush = () => {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach((fn) => fn())
  }
  port.postMessage.mockClear()
  for (let i = 0; i < 30; i++) move(i % 2 ? b : a)
  expect(frames.size).toBe(1)
  flush()
  expect(port.postMessage).toHaveBeenCalledTimes(1)
  expect(port.postMessage.mock.calls[0][0]).toMatchObject({
    type: 'hover',
    nodeId: b.getAttribute('data-editor-node'),
  })
  move(b)
  flush()
  expect(port.postMessage).toHaveBeenCalledTimes(1)
  a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  move(b)
  doc.documentElement.dispatchEvent(new Event('pointerleave'))
  flush()
  expect(port.postMessage.mock.calls.at(-1)![0]).toMatchObject({ type: 'clear-hover' })
  port.onmessage!({ data: { type: 'parent' } })
  expect(port.postMessage.mock.calls.at(-1)![0]).toMatchObject({
    type: 'select',
    nodeId: doc.querySelector('main')!.getAttribute('data-editor-node'),
  })
  move(a)
  win.dispatchEvent(new Event('pagehide'))
  expect(frames.size).toBe(0)
  expect(port.close).toHaveBeenCalledOnce()
})
