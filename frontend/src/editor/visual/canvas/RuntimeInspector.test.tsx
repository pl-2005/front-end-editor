import { act, fireEvent, render, screen } from '@testing-library/react'
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
  vi.unstubAllGlobals()
  channels.length = 0
})

it('keeps the runtime mounted across mode commands and rejects stale source messages', () => {
  vi.stubGlobal('MessageChannel', TestChannel)
  const doc = new Y.Doc(),
    meta = doc.getMap('meta'),
    content = new Y.Text('<html><head></head><body><p>中文😀</p></body></html>')
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
  emit({ type: 'ready', fileId: 'f', generation: registry.generation })
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'mode', active: true })
  const hit = {
    type: 'hover',
    fileId: 'f',
    generation: registry.generation,
    nodeId: node.id,
    tag: 'p',
    rect: { x: 1, y: 2, width: 100, height: 20 },
  }
  emit(hit)
  expect(onInspect.mock.calls.at(-1)![0].range).toEqual(node.range)
  emit({ ...hit, type: 'select' })
  expect(onLocate).toHaveBeenCalledOnce()
  emit({ ...hit, type: 'select', nodeId: '' })
  expect(screen.getByText(/运行时生成的元素/)).toBeTruthy()
  expect(
    (screen.getByRole('button', { name: '打开源码并定位' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  view.rerender(
    <RuntimeInspector {...props} inspecting={false}>
      <iframe title="runtime" />
    </RuntimeInspector>,
  )
  expect(screen.getByTitle('runtime')).toBe(frame)
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'mode', active: false })
  const calls = onLocate.mock.calls.length
  emit({ ...hit, type: 'select' })
  expect(onLocate).toHaveBeenCalledTimes(calls)
  view.rerender(
    <RuntimeInspector {...props} inspecting>
      <iframe title="runtime" />
    </RuntimeInspector>,
  )
  act(() => content.insert(0, '<!--remote-->'))
  expect(port.close).toHaveBeenCalledOnce()
  emit(hit)
  expect(onInspect).toHaveBeenLastCalledWith(undefined)
  expect(view.container.querySelector('.v3-hover')).toBeNull()
  expect(view.container.querySelector('.v3-selection')).toBeNull()
  view.unmount()
  doc.destroy()
})
