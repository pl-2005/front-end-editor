import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { CollaborationSession } from '../../../collaboration/session'
import { readDocument } from '../../../collaboration/document'
import { RuntimeInspector } from './RuntimeInspector'
import { RuntimeProjection } from './runtimeProjection'

const channels: TestChannel[] = []
class TestChannel {
  port1 = {
    start: vi.fn(),
    close: vi.fn(),
    postMessage: vi.fn(),
    onmessage: null as null | ((event: { data: unknown }) => void),
  }
  port2 = {}
  constructor() {
    channels.push(this)
  }
}
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  channels.length = 0
})

function setup(source = '<html><head></head><body><p>中文😀</p></body></html>') {
  vi.stubGlobal('MessageChannel', TestChannel)
  const frames = new Map<number, FrameRequestCallback>()
  let sequence = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback)
    return sequence
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const flush = () =>
    act(() => {
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach((callback) => callback(0))
    })
  const doc = new Y.Doc(),
    meta = doc.getMap('meta'),
    content = new Y.Text(source)
  for (const [key, value] of Object.entries({
    schemaVersion: 1,
    projectId: 7,
    epoch: 1,
    entryFileId: 'f',
  }))
    meta.set(key, value)
  const file = new Y.Map<unknown>()
  for (const [key, value] of Object.entries({
    id: 'f',
    path: '/index.html',
    language: 'html',
    deletedAt: null,
    content,
  }))
    file.set(key, value)
  doc.getMap('files').set('f', file)
  doc.getArray('fileOrder').push(['f'])
  const session = { doc, identity: { projectId: 7, epoch: 1 } } as CollaborationSession
  const projection = new RuntimeProjection()
  projection.project(readDocument(doc, session.identity).files, {})
  const registry = projection.registries.get('f')!,
    node = [...registry.nodes.values()].find((node) => node.tag === 'p')!
  const onLocate = vi.fn(),
    onInspect = vi.fn()
  const props = { session, projection, onLocate, onInspect }
  const view = render(
    <RuntimeInspector {...props} inspecting>
      <iframe title="runtime" />
    </RuntimeInspector>,
  )
  const frame = screen.getByTitle('runtime') as HTMLIFrameElement
  const hello = {
    type: 'runtime-hello',
    capability: projection.capability,
    fileId: 'f',
    generation: registry.generation,
  }
  fireEvent(window, new MessageEvent('message', { source: window, data: hello }))
  expect(channels).toHaveLength(0)
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, data: hello }))
  expect(channels).toHaveLength(1)
  const port = channels[0].port1
  const emit = (data: unknown) => act(() => port.onmessage?.({ data }))
  const ready = { type: 'ready', fileId: 'f', generation: registry.generation }
  emit(ready)
  const revision = () =>
    port.postMessage.mock.calls.filter(([m]) => m.type === 'mode').at(-1)![0].modeRevision as number
  const ack = (value = revision()) => emit({ ...ready, type: 'mode-ready', modeRevision: value })
  ack()
  const hit = {
    type: 'hover',
    fileId: 'f',
    generation: registry.generation,
    nodeId: node.id,
    tag: 'p',
    modeRevision: revision(),
    sourceStatus: 'candidate',
    sourceReason: '',
    rect: { x: 1, y: 2, width: 100, height: 20 },
  }
  const mode = (inspecting: boolean) =>
    view.rerender(
      <RuntimeInspector {...props} inspecting={inspecting}>
        <iframe title="runtime" />
      </RuntimeInspector>,
    )
  return {
    doc,
    content,
    projection,
    registry,
    node,
    view,
    frame,
    hello,
    port,
    emit,
    hit,
    flush,
    frames,
    mode,
    revision,
    ack,
    ready,
    onLocate,
    onInspect,
  }
}

it('keeps the runtime and channel across modes, clears immediately, and rejects old revisions', () => {
  const t = setup()
  t.emit(t.hit)
  t.flush()
  expect(t.onInspect.mock.calls.at(-1)![0].range).toEqual(t.node.range)
  t.emit({ ...t.hit, type: 'select' })
  t.flush()
  expect(t.onLocate).toHaveBeenCalledOnce()
  t.mode(false)
  expect(t.view.container.querySelector('.v3-selection')).toBeNull()
  expect(t.onInspect).toHaveBeenLastCalledWith(undefined)
  t.mode(true)
  expect(screen.getByText(/检查工具正在连接/)).toBeTruthy()
  expect(screen.getByTitle('runtime')).toBe(t.frame)
  expect(channels).toHaveLength(1)
  expect(t.port.close).not.toHaveBeenCalled()
  t.ack(t.hit.modeRevision)
  expect(screen.getByText(/检查工具正在连接/)).toBeTruthy()
  t.emit({ ...t.hit, type: 'select' })
  t.flush()
  expect(t.onLocate).toHaveBeenCalledOnce()
  t.ack()
  t.emit({ ...t.hit, type: 'select', modeRevision: t.revision() })
  t.flush()
  expect(t.onLocate).toHaveBeenCalledTimes(2)
  t.emit({ ...t.ready, type: 'clear-selection', modeRevision: t.hit.modeRevision })
  expect(t.view.container.querySelector('.v3-selection')).not.toBeNull()
})

it('cancels pending hits and refuses to reconnect stale source', () => {
  const t = setup()
  t.emit(t.hit)
  expect(t.frames.size).toBe(1)
  act(() => t.content.insert(0, '<!--remote-->'))
  expect(t.frames.size).toBe(0)
  expect(t.port.close).toHaveBeenCalledOnce()
  t.emit(t.hit)
  t.flush()
  expect(t.onInspect).toHaveBeenLastCalledWith(undefined)
  fireEvent(window, new MessageEvent('message', { source: t.frame.contentWindow, data: t.hello }))
  expect(channels).toHaveLength(1)
})

it('closes on navigation and document identity changes', () => {
  const t = setup()
  fireEvent.load(t.frame)
  expect(t.port.close).toHaveBeenCalledOnce()
  fireEvent(window, new MessageEvent('message', { source: t.frame.contentWindow, data: t.hello }))
  const next = channels[1].port1
  act(() => t.doc.getMap('meta').set('epoch', 2))
  expect(next.close).toHaveBeenCalledOnce()
})

it('replaces an unready old-document hello with the new running document and protects a ready channel', () => {
  const t = setup()
  fireEvent.load(t.frame)
  fireEvent(window, new MessageEvent('message', { source: t.frame.contentWindow, data: t.hello }))
  const stale = channels[1].port1
  const other = new Y.Text('<html><head></head><body><p>new page</p></body></html>')
  act(() =>
    t.doc.transact(() => {
      const file = new Y.Map<unknown>()
      for (const [key, value] of Object.entries({
        id: 'b',
        path: '/new.html',
        language: 'html',
        deletedAt: null,
        content: other,
      }))
        file.set(key, value)
      t.doc.getMap('files').set('b', file)
      t.doc.getArray('fileOrder').push(['b'])
    }),
  )
  t.projection.project(readDocument(t.doc, { projectId: 7, epoch: 1 }).files, {})
  const registry = t.projection.registries.get('b')!
  const hello = { ...t.hello, fileId: 'b', generation: registry.generation }
  fireEvent(window, new MessageEvent('message', { source: t.frame.contentWindow, data: hello }))
  expect(stale.close).toHaveBeenCalledOnce()
  expect(channels).toHaveLength(3)
  const current = channels[2].port1
  act(() =>
    current.onmessage?.({ data: { type: 'ready', fileId: 'b', generation: registry.generation } }),
  )
  expect(screen.getByText(/检查工具正在连接/)).toBeTruthy()
  const revision = current.postMessage.mock.calls.find(([message]) => message.type === 'mode')![0]
    .modeRevision
  act(() =>
    current.onmessage?.({
      data: {
        type: 'mode-ready',
        fileId: 'b',
        generation: registry.generation,
        modeRevision: revision,
      },
    }),
  )
  expect(screen.getByText('当前检查：/new.html')).toBeTruthy()
  const commands = current.postMessage.mock.calls.length
  act(() =>
    current.onmessage?.({ data: { type: 'ready', fileId: 'b', generation: registry.generation } }),
  )
  expect(current.postMessage).toHaveBeenCalledTimes(commands)
  fireEvent(window, new MessageEvent('message', { source: t.frame.contentWindow, data: t.hello }))
  expect(channels).toHaveLength(3)
  expect(current.close).not.toHaveBeenCalled()
})

it('releases an unready channel after five seconds and allows a later handshake', () => {
  vi.useFakeTimers()
  const t = setup()
  fireEvent.load(t.frame)
  fireEvent(window, new MessageEvent('message', { source: t.frame.contentWindow, data: t.hello }))
  const stalled = channels[1].port1
  act(() => vi.advanceTimersByTime(5000))
  expect(stalled.close).toHaveBeenCalledOnce()
  expect(screen.getByText(/当前运行页无法检查/)).toBeTruthy()
  fireEvent(window, new MessageEvent('message', { source: t.frame.contentWindow, data: t.hello }))
  const next = channels[2].port1
  act(() => next.onmessage?.({ data: t.ready }))
  expect(screen.getByText(/检查工具正在连接/)).toBeTruthy()
  const revision = next.postMessage.mock.calls.find(([message]) => message.type === 'mode')![0]
    .modeRevision
  act(() => next.onmessage?.({ data: { ...t.ready, type: 'mode-ready', modeRevision: revision } }))
  act(() => vi.advanceTimersByTime(5000))
  expect(next.close).not.toHaveBeenCalled()
  expect(screen.getByText('当前检查：/index.html')).toBeTruthy()
})

it('inspects ambiguous and dynamic elements without granting a source location', () => {
  const t = setup()
  for (const sourceStatus of ['ambiguous', 'unmapped']) {
    t.emit({ ...t.hit, type: 'select', nodeId: '', sourceStatus, sourceReason: '来源无法确认' })
    t.flush()
    expect(screen.getByText(/来源无法确认/)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: '打开源码并定位' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  }
  expect(t.onLocate).not.toHaveBeenCalled()
})

it('keeps the actual running file A as source target when code and entry file B change', () => {
  const t = setup()
  const other = new Y.Text('<html><body><p>代码 B</p></body></html>')
  act(() =>
    t.doc.transact(() => {
      const file = new Y.Map<unknown>()
      for (const [key, value] of Object.entries({
        id: 'b',
        path: '/other.html',
        language: 'html',
        deletedAt: null,
        content: other,
      }))
        file.set(key, value)
      t.doc.getMap('files').set('b', file)
      t.doc.getArray('fileOrder').push(['b'])
      t.doc.getMap('meta').set('entryFileId', 'b')
    }),
  )
  act(() => other.insert(0, '<!--code B edit-->'))
  expect(t.port.close).not.toHaveBeenCalled()
  t.emit({ ...t.hit, type: 'select' })
  t.flush()
  expect(screen.getByText('当前检查：/index.html')).toBeTruthy()
  expect(t.onLocate).toHaveBeenLastCalledWith(
    expect.objectContaining({ fileId: 'f', source: t.registry.source }),
  )
  fireEvent.click(screen.getByRole('button', { name: '打开源码并定位' }))
  expect(t.onLocate).toHaveBeenLastCalledWith(
    expect.objectContaining({ fileId: 'f', openCode: true }),
  )
})

it('rejects malformed messages and coalesces near-limit source hits without repeated source reads', () => {
  const t = setup(`<html><head></head><body><p>${'x'.repeat(200 * 1024 - 100)}</p></body></html>`)
  const stringify = vi.fn(() => Y.Text.prototype.toString.call(t.content))
  Object.defineProperty(t.content, 'toString', { configurable: true, value: stringify })
  const baseline = t.onInspect.mock.calls.length
  for (const malformed of [
    { ...t.hit, extra: true },
    { ...t.hit, modeRevision: -1 },
    { ...t.hit, rect: { ...t.hit.rect, x: Infinity } },
    { ...t.hit, sourceStatus: 'authorized' },
    { ...t.hit, sourceReason: 'x'.repeat(501) },
    { ...t.hit, nodeId: '', sourceStatus: 'candidate' },
  ])
    t.emit(malformed)
  t.flush()
  expect(t.onInspect).toHaveBeenCalledTimes(baseline)
  const started = performance.now()
  for (let i = 0; i < 1000; i++) t.emit({ ...t.hit, rect: { ...t.hit.rect, x: i } })
  expect(t.frames.size).toBe(1)
  t.flush()
  expect(t.view.container.querySelector<HTMLElement>('.v3-hover')!.style.left).toBe('999px')
  expect(t.onInspect).toHaveBeenCalledTimes(baseline + 1)
  expect(stringify).not.toHaveBeenCalled()
  console.info(
    `RuntimeInspector: 1000 valid hits / ${new TextEncoder().encode(t.registry.source).length} source bytes, 1 frame, 0 source reads, ${(performance.now() - started).toFixed(1)} ms`,
  )
  act(() => t.doc.getMap('meta').set('entryFileId', 'f'))
  expect(stringify).toHaveBeenCalled()
})
