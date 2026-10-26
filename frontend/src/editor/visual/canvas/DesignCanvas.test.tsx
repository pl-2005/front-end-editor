import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { DesignCanvas } from './DesignCanvas'

const channels: TestChannel[] = []
class TestChannel {
  port1 = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    start: vi.fn(),
    close: vi.fn(),
    postMessage: vi.fn(),
  }
  port2 = { close: vi.fn() }
  constructor() {
    channels.push(this)
  }
}
function fixture() {
  const doc = new Y.Doc()
  const content = doc.getText('html')
  content.insert(
    0,
    '<!doctype html><html><head></head><body><main><p>中文😀 &amp;</p></main></body></html>',
  )
  const file = { id: 'f', path: '/a.html', language: 'html', content, deletedAt: null }
  return { doc, file, files: [file], onLocate: vi.fn() }
}
async function frame() {
  return (await screen.findByTitle('静态 HTML 设计画布')) as HTMLIFrameElement
}
function config(iframe: HTMLIFrameElement) {
  const doc = new DOMParser().parseFromString(iframe.srcdoc, 'text/html')
  const script = doc.querySelector('script')!.textContent!
  const data = JSON.parse(script.slice(script.lastIndexOf(')(') + 2, -1))
  const nodeId = doc.querySelector('p')!.getAttribute('data-editor-node')
  return { ...data, nodeId }
}
async function connect(iframe: HTMLIFrameElement, repeated = false) {
  const expected = channels.length + (repeated ? 0 : 1)
  const data = config(iframe)
  await waitFor(() => {
    fireEvent(
      window,
      new MessageEvent('message', {
        source: iframe.contentWindow,
        data: {
          type: 'hello',
          capability: data.capability,
          generation: data.generation,
          fileId: data.fileId,
        },
      }),
    )
    expect(channels.length).toBe(expected)
  })
  const channel = channels.at(-1)!
  act(() =>
    channel.port1.onmessage?.({
      data: { type: 'ready', fileId: data.fileId, generation: data.generation },
    }),
  )
  return {
    data,
    channel,
    select: (changes = {}) =>
      act(() =>
        channel.port1.onmessage?.({
          data: {
            type: 'select',
            fileId: data.fileId,
            generation: data.generation,
            nodeId: data.nodeId,
            rect: { x: 8, y: 16, width: 100, height: 20 },
            ...changes,
          },
        }),
      ),
  }
}
describe('DesignCanvas lifecycle', () => {
  beforeEach(() => {
    channels.length = 0
    vi.stubGlobal('MessageChannel', TestChannel)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  it('keeps inspection separate from locked selection and clears only transient state', async () => {
    const props = { ...fixture(), onInspect: vi.fn() }
    const { unmount } = render(<DesignCanvas {...props} />)
    const iframe = await frame()
    const connected = await connect(iframe)
    connected.select()
    const doc = new DOMParser().parseFromString(iframe.srcdoc, 'text/html')
    const parentId = doc.querySelector('main')!.getAttribute('data-editor-node')
    connected.select({ type: 'hover', nodeId: parentId })
    expect(props.onLocate).toHaveBeenCalledTimes(1)
    const inspection = props.onInspect.mock.calls.at(-1)![0]
    expect(inspection.source.slice(inspection.range.start, inspection.range.end)).toContain(
      '<main>',
    )
    expect(screen.getByText('<p> · 源码范围明确')).toBeTruthy()
    connected.select({
      type: 'hover',
      nodeId: parentId,
      rect: { x: 1, y: -3, width: 200, height: 100 },
    })
    expect(props.onInspect).toHaveBeenCalledTimes(1)
    fireEvent.pointerLeave(iframe)
    expect(props.onInspect).toHaveBeenLastCalledWith(undefined)
    expect(screen.getByText('<p> · 源码范围明确')).toBeTruthy()
    expect(connected.channel.port1.postMessage).toHaveBeenCalledWith({ type: 'clear-hover' })
    connected.select({ type: 'hover', generation: 'old' })
    expect(props.onInspect).toHaveBeenCalledTimes(2)
    connected.select({ type: 'hover' })
    // Monaco may stop bubbling keyboard events; the canvas listens in capture.
    const stop = (event: KeyboardEvent) => event.stopPropagation()
    document.body.addEventListener('keydown', stop)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    document.body.removeEventListener('keydown', stop)
    expect(props.onInspect).toHaveBeenLastCalledWith(undefined)
    expect(screen.getByText('<p> · 源码范围明确')).toBeTruthy()
    connected.select({ type: 'hover' })
    fireEvent.blur(window)
    expect(props.onInspect).toHaveBeenLastCalledWith(undefined)
    expect(screen.getByText('<p> · 源码范围明确')).toBeTruthy()
    unmount()
    expect(props.onInspect).toHaveBeenLastCalledWith(undefined)
    expect(props.file.content.toString()).toContain('中文😀 &amp;')
    props.doc.destroy()
  })
  it('authenticates the iframe source, consumes hello once, selects and locates exact source', async () => {
    const props = fixture()
    const { rerender, unmount } = render(<DesignCanvas {...props} />)
    const iframe = await frame()
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer')
    const data = config(iframe)
    fireEvent(
      window,
      new MessageEvent('message', {
        source: window,
        data: {
          type: 'hello',
          capability: data.capability,
          generation: data.generation,
          fileId: data.fileId,
        },
      }),
    )
    expect(channels).toHaveLength(0)
    const connected = await connect(iframe)
    await connect(iframe, true)
    expect(channels).toHaveLength(1)
    connected.select()
    expect(props.onLocate).toHaveBeenCalledTimes(1)
    const location = props.onLocate.mock.calls[0][0]
    expect(location.source.slice(location.range.start, location.range.end)).toBe(
      '<p>中文😀 &amp;</p>',
    )
    expect(screen.getByText('<p> · 源码范围明确')).toBeTruthy()
    // Geometry-only updates and unrelated session revisions must preserve the channel/focus.
    connected.select({ rect: { x: 8, y: -4, width: 100, height: 20 } })
    expect(props.onLocate).toHaveBeenCalledTimes(1)
    rerender(<DesignCanvas {...props} files={[...props.files]} />)
    expect(connected.channel.port1.close).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('选择父级'))
    expect(connected.channel.port1.postMessage).toHaveBeenCalledWith({ type: 'parent' })
    unmount()
    expect(connected.channel.port1.close).toHaveBeenCalledOnce()
    props.doc.destroy()
  })
  it('rejects old selections immediately before the debounce rebuild', async () => {
    const props = fixture()
    const { rerender } = render(<DesignCanvas {...props} />)
    const first = await frame()
    const old = await connect(first)
    props.file.content.insert(0, '<!--new-->')
    old.select()
    expect(props.onLocate).not.toHaveBeenCalled()
    rerender(<DesignCanvas {...props} files={[...props.files]} />)
    expect(screen.queryByTitle('静态 HTML 设计画布')).toBeNull()
    expect(old.channel.port1.close).toHaveBeenCalledOnce()
    const second = await frame()
    expect(config(second).generation).not.toBe(old.data.generation)
    old.select()
    expect(props.onLocate).not.toHaveBeenCalled()
    const current = await connect(second)
    current.select()
    expect(props.onLocate).toHaveBeenCalledOnce()
    props.doc.destroy()
  })
  it('revokes the port after iframe reload and keeps non-HTML read-only', async () => {
    const props = fixture()
    const { rerender } = render(<DesignCanvas {...props} />)
    const iframe = await frame()
    const connected = await connect(iframe)
    fireEvent.load(iframe)
    fireEvent.load(iframe)
    expect(connected.channel.port1.close).toHaveBeenCalledOnce()
    connected.select()
    expect(props.onLocate).not.toHaveBeenCalled()
    rerender(<DesignCanvas {...props} file={{ ...props.file, language: 'javascript' }} />)
    await waitFor(() => expect(screen.queryByTitle('静态 HTML 设计画布')).toBeNull())
    expect(screen.getByRole('status').textContent).toContain('请选择 HTML')
    props.doc.destroy()
  })
})
