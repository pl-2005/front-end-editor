import type { ReactNode } from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { CollaborationSession } from '../../collaboration/session'
import { SandpackBridge } from './SandpackBridge'

const runtime = vi.hoisted(() => {
  const files: Record<string, { code: string }> = {}
  return { files, updateFile: vi.fn((next: typeof files) => Object.assign(files, next)), deleteFile: vi.fn(), dispatch: vi.fn(),
    listener: undefined as undefined | ((message: { type: string }) => void), unsubscribe: vi.fn() }
})
vi.mock('@codesandbox/sandpack-react', () => ({
  SandpackProvider: ({ children }: { children: ReactNode }) => children,
  SandpackPreview: () => <div>Preview</div>, SandpackConsole: () => <div>Console</div>,
  useSandpack: () => ({ sandpack: runtime, dispatch: runtime.dispatch,
    listen: (listener: typeof runtime.listener) => { runtime.listener = listener; return runtime.unsubscribe } }),
}))
function fixture() {
  const doc = new Y.Doc(), text = new Y.Text('<h1>Initial</h1>')
  const meta = doc.getMap('meta'), file = new Y.Map<unknown>()
  Object.entries({ schemaVersion: 1, projectId: 7, epoch: 1, entryFileId: 'entry' }).forEach(([k, v]) => meta.set(k, v))
  Object.entries({ id: 'entry', path: '/index.html', language: 'html', deletedAt: null, content: text }).forEach(([k, v]) => file.set(k, v))
  doc.getMap('files').set('entry', file); doc.getArray('fileOrder').push(['entry'])
  return { doc, text, identity: { projectId: 7, epoch: 1 } }
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); Object.keys(runtime.files).forEach(k => delete runtime.files[k]) })
describe('Sandpack document projection lifecycle', () => {
  it('replays the latest document once after initialization and refreshes repaired HTML', () => {
    vi.useFakeTimers()
    const f = fixture(), view = render(<SandpackBridge session={f as unknown as CollaborationSession} entry="/index.html" structureKey="initial" />)
    act(() => f.doc.transact(() => { f.text.delete(0, f.text.length); f.text.insert(0, '<h1>Repaired</h1>') }))
    act(() => vi.advanceTimersByTime(300))
    runtime.updateFile.mockClear()
    act(() => { runtime.listener!({ type: 'done' }); vi.advanceTimersByTime(0) })
    expect(runtime.updateFile.mock.calls[0][0]['/index.html'].code).toContain('Repaired')
    act(() => { runtime.listener!({ type: 'done' }); vi.advanceTimersByTime(750) })
    expect(runtime.updateFile).toHaveBeenCalledTimes(1)
    expect(runtime.dispatch).toHaveBeenCalledWith({ type: 'refresh' })
    expect(f.doc.getMap('files').size).toBe(1)
    view.unmount(); f.doc.destroy()
  })
  it('cancels queued projection and refresh after closing the workspace', () => {
    vi.useFakeTimers()
    const f = fixture(), view = render(<SandpackBridge session={f as unknown as CollaborationSession} entry="/index.html" structureKey="initial" />)
    runtime.updateFile.mockClear(); runtime.dispatch.mockClear()
    act(() => f.text.insert(0, '<!-- pending -->'))
    view.unmount()
    act(() => { f.text.insert(0, '<!-- closed -->'); vi.advanceTimersByTime(2000) })
    expect(runtime.updateFile).not.toHaveBeenCalled(); expect(runtime.dispatch).not.toHaveBeenCalled()
    expect(runtime.unsubscribe).toHaveBeenCalledTimes(1)
    f.doc.destroy()
  })
})
