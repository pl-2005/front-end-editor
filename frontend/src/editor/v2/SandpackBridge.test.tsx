import type { ReactElement, ReactNode } from 'react'
import { act, fireEvent, render as renderUI, screen } from '@testing-library/react'
import { AppTheme } from '../../ui/AppTheme'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { CollaborationSession } from '../../collaboration/session'
import { SandpackBridge } from './SandpackBridge'
import { previewProjection } from './projection'

const render = (ui: ReactElement) => renderUI(ui, { wrapper: AppTheme })

const runtime = vi.hoisted(() => {
  const files: Record<string, { code: string }> = {}
  return {
    files,
    updateFile: vi.fn((next: typeof files) => Object.assign(files, next)),
    deleteFile: vi.fn(),
    dispatch: vi.fn(),
    listener: undefined as
      undefined | ((message: { type: string; payload?: { data: string; type: string } }) => void),
    unsubscribe: vi.fn(),
  }
})
vi.mock('@codesandbox/sandpack-react', () => ({
  SandpackProvider: ({ children }: { children: ReactNode }) => {
    return children
  },
  SandpackPreview: ({
    actionsChildren,
    showRestartButton,
  }: {
    actionsChildren: ReactNode
    showRestartButton?: boolean
  }) => (
    <div>
      <iframe title="Sandpack Preview" />
      {showRestartButton !== false ? (
        <button onClick={() => runtime.dispatch({ type: 'shell/restart' })}>Restart script</button>
      ) : (
        actionsChildren
      )}
    </div>
  ),
  SandpackConsole: ({ actionsChildren }: { actionsChildren: ReactNode }) => (
    <div>Console{actionsChildren}</div>
  ),
  RestartIcon: () => <span />,
  useSandpack: () => ({
    sandpack: runtime,
    dispatch: runtime.dispatch,
    listen: (listener: typeof runtime.listener) => {
      runtime.listener = listener
      return runtime.unsubscribe
    },
  }),
}))
function fixture() {
  const doc = new Y.Doc(),
    text = new Y.Text('<h1>Initial</h1>')
  const meta = doc.getMap('meta'),
    file = new Y.Map<unknown>()
  Object.entries({ schemaVersion: 1, projectId: 7, epoch: 1, entryFileId: 'entry' }).forEach(
    ([k, v]) => meta.set(k, v),
  )
  Object.entries({
    id: 'entry',
    path: '/index.html',
    language: 'html',
    deletedAt: null,
    content: text,
  }).forEach(([k, v]) => file.set(k, v))
  doc.getMap('files').set('entry', file)
  doc.getArray('fileOrder').push(['entry'])
  const state = { synced: false }
  return {
    doc,
    text,
    identity: { projectId: 7, epoch: 1 },
    subscribe: () => () => {},
    snapshot: () => state,
  }
}
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  Object.keys(runtime.files).forEach((k) => delete runtime.files[k])
})
describe('Sandpack document projection lifecycle', () => {
  it('recreates the preview from the latest document on restart without changing its source', () => {
    vi.useFakeTimers()
    const f = fixture(),
      view = render(
        <SandpackBridge
          session={f as unknown as CollaborationSession}
          entry="/index.html"
          structureKey="initial"
        />,
      )
    const frame = screen.getByTitle('Sandpack Preview')
    act(() => f.text.insert(0, '<!-- latest -->'))
    const source = f.text.toString()
    fireEvent.click(screen.getAllByRole('button', { name: /重启预览|Restart script/ })[0])
    expect(screen.getByTitle('Sandpack Preview')).not.toBe(frame)
    expect(runtime.dispatch).not.toHaveBeenCalledWith({ type: 'shell/restart' })
    expect(runtime.updateFile.mock.calls.at(-1)?.[0]['/index.html'].code).toContain('latest')
    expect(f.text.toString()).toBe(source)
    expect(f.doc.getMap('files').size).toBe(1)
    const restartedFrame = screen.getByTitle('Sandpack Preview')
    fireEvent.click(screen.getAllByRole('button', { name: '重启预览' })[1])
    expect(screen.getByTitle('Sandpack Preview')).not.toBe(restartedFrame)
    expect(f.text.toString()).toBe(source)
    view.unmount()
    f.doc.destroy()
  })
  it('restricts preview navigation and referrer disclosure, including dynamically added runtime frames', async () => {
    const f = fixture(),
      view = render(
        <SandpackBridge
          session={f as unknown as CollaborationSession}
          entry="/index.html"
          structureKey="initial"
        />,
      )
    const frame = view.getByTitle('Sandpack Preview') as HTMLIFrameElement
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms')
    expect(frame.referrerPolicy).toBe('no-referrer')
    const runtime = document.createElement('iframe')
    await act(async () => {
      frame.parentElement!.append(runtime)
    })
    expect(runtime.getAttribute('sandbox')).not.toContain('allow-top-navigation')
    expect(runtime.getAttribute('sandbox')).not.toContain('allow-popups')
    expect(runtime.referrerPolicy).toBe('no-referrer')
    view.unmount()
    f.doc.destroy()
  })
  it('replays only changed files once after initialization without forcing another refresh', () => {
    vi.useFakeTimers()
    const f = fixture(),
      view = render(
        <SandpackBridge
          session={f as unknown as CollaborationSession}
          entry="/index.html"
          structureKey="initial"
        />,
      )
    act(() =>
      f.doc.transact(() => {
        f.text.delete(0, f.text.length)
        f.text.insert(0, '<h1>Repaired</h1>')
      }),
    )
    act(() => vi.advanceTimersByTime(300))
    runtime.updateFile.mockClear()
    act(() => {
      runtime.listener!({ type: 'done' })
      vi.advanceTimersByTime(0)
    })
    expect(runtime.updateFile.mock.calls[0][0]['/index.html'].code).toContain('Repaired')
    expect(Object.keys(runtime.updateFile.mock.calls[0][0])).toEqual(['/index.html'])
    act(() => {
      runtime.listener!({ type: 'done' })
      vi.advanceTimersByTime(750)
    })
    expect(runtime.updateFile).toHaveBeenCalledTimes(1)
    expect(runtime.dispatch).not.toHaveBeenCalledWith({ type: 'refresh' })
    expect(f.doc.getMap('files').size).toBe(1)
    view.unmount()
    f.doc.destroy()
  })
  it('does not resend an unchanged startup document', () => {
    vi.useFakeTimers()
    const f = fixture()
    Object.assign(runtime.files, previewProjection(f).files)
    const view = render(
      <SandpackBridge
        session={f as unknown as CollaborationSession}
        entry="/index.html"
        structureKey="initial"
      />,
    )
    act(() => {
      runtime.listener!({ type: 'done' })
      vi.advanceTimersByTime(2000)
    })
    expect(runtime.updateFile).not.toHaveBeenCalled()
    expect(runtime.dispatch).not.toHaveBeenCalled()
    view.unmount()
    f.doc.destroy()
  })
  it('refreshes only when an HTML parse error has disconnected hot updates', () => {
    vi.useFakeTimers()
    const f = fixture()
    Object.assign(runtime.files, previewProjection(f).files)
    const view = render(
      <SandpackBridge
        session={f as unknown as CollaborationSession}
        entry="/index.html"
        structureKey="initial"
      />,
    )
    act(() => {
      runtime.listener!({ type: 'done' })
      vi.advanceTimersByTime(0)
      runtime.listener!({
        type: 'stdout',
        payload: {
          type: 'err',
          data: 'Internal server error: Unable to parse HTML; at /nodebox/index.html:1:1',
        },
      })
      f.text.insert(0, '<!-- repaired -->')
      vi.advanceTimersByTime(300)
    })
    expect(runtime.dispatch).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(750))
    expect(runtime.dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'refresh' })
    runtime.dispatch.mockClear()
    act(() => {
      f.text.insert(0, '<!-- normal edit -->')
      vi.advanceTimersByTime(2000)
    })
    expect(runtime.dispatch).not.toHaveBeenCalled()
    view.unmount()
    f.doc.destroy()
  })
  it('coalesces rapid HTML edits into one update while preserving the preview frame', () => {
    vi.useFakeTimers()
    const f = fixture()
    Object.assign(runtime.files, previewProjection(f).files)
    const view = render(
      <SandpackBridge
        session={f as unknown as CollaborationSession}
        entry="/index.html"
        structureKey="initial"
      />,
    )
    const frame = screen.getByTitle('Sandpack Preview')
    act(() => {
      runtime.listener!({ type: 'done' })
      vi.advanceTimersByTime(0)
    })
    runtime.updateFile.mockClear()
    act(() => f.text.insert(0, '<!-- first -->'))
    act(() => vi.advanceTimersByTime(200))
    act(() => f.text.insert(0, '<!-- latest -->'))
    act(() => vi.advanceTimersByTime(299))
    expect(runtime.updateFile).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(runtime.updateFile).toHaveBeenCalledTimes(1)
    expect(runtime.updateFile.mock.calls[0][0]['/index.html'].code).toContain('latest')
    act(() => vi.advanceTimersByTime(2000))
    expect(runtime.dispatch).not.toHaveBeenCalled()
    expect(screen.getByTitle('Sandpack Preview')).toBe(frame)
    view.unmount()
    f.doc.destroy()
  })
  it('cancels queued projection and refresh after closing the workspace', () => {
    vi.useFakeTimers()
    const f = fixture(),
      view = render(
        <SandpackBridge
          session={f as unknown as CollaborationSession}
          entry="/index.html"
          structureKey="initial"
        />,
      )
    runtime.updateFile.mockClear()
    runtime.dispatch.mockClear()
    act(() => f.text.insert(0, '<!-- pending -->'))
    view.unmount()
    act(() => {
      f.text.insert(0, '<!-- closed -->')
      vi.advanceTimersByTime(2000)
    })
    expect(runtime.updateFile).not.toHaveBeenCalled()
    expect(runtime.dispatch).not.toHaveBeenCalled()
    expect(runtime.unsubscribe).toHaveBeenCalledTimes(1)
    f.doc.destroy()
  })
})
