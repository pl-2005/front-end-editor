import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDraft } from '../persistence/drafts'
import type { ProjectFiles } from '../types/project'
import { useProjectSave } from './useProjectSave'

const initialFiles: ProjectFiles = { '/index.html': { code: '<h1>Hello</h1>' } }

function SaveHarness() {
  const [files, setFiles] = useState(initialFiles)
  const [version, setVersion] = useState('1:0')
  const { status, message } = useProjectSave({
    projectId: 1,
    initialVersion: 0,
    entry: '/index.html',
    files,
    onVersionChange: (projectId, nextVersion) => setVersion(`${projectId}:${nextVersion}`),
  })

  return <div>
    <output aria-label="状态">{status}</output>
    <output aria-label="消息">{message}</output>
    <output aria-label="版本">{version}</output>
    <button type="button" onClick={() => setFiles((current) => ({
      '/index.html': { code: `${current['/index.html'].code}!` },
    }))}>编辑</button>
  </div>
}

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('useProjectSave', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('debounces edits and reports the saved version', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(response({
      data: { version: 1, contentHash: 'hash', savedAt: '2026-09-20T00:00:00Z' },
      message: 'ok',
      status: 200,
    })))
    vi.stubGlobal('fetch', fetchMock)
    render(<SaveHarness />)

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.getByLabelText('状态').textContent).toBe('dirty')

    await act(async () => { await vi.advanceTimersByTimeAsync(1499) })
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    vi.useRealTimers()

    await waitFor(() => expect(screen.getByLabelText('状态').textContent).toBe('saved'))
    expect(screen.getByLabelText('版本').textContent).toBe('1:1')
  })

  it('keeps the draft and exposes conflict state after a 409 response', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response({ message: '版本冲突', code: 'VERSION_CONFLICT' }, 409))))
    render(<SaveHarness />)

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    vi.useRealTimers()

    await waitFor(() => expect(screen.getByLabelText('状态').textContent).toBe('conflict'))
    expect(screen.getByLabelText('消息').textContent).toContain('版本冲突')
    await waitFor(async () => expect((await getDraft(1))?.baseVersion).toBe(0))
  })

  it('serializes a pending edit after a slow save finishes', async () => {
    const firstSave = deferred<Response>()
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementation(() => Promise.resolve(response({ data: { version: 2, contentHash: 'second', savedAt: '2026-09-20T00:00:01Z' }, message: 'ok', status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    render(<SaveHarness />)

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })

    await act(async () => {
      firstSave.resolve(response({ data: { version: 1, contentHash: 'first', savedAt: '2026-09-20T00:00:00Z' }, message: 'ok', status: 200 }))
      await vi.advanceTimersByTimeAsync(0)
    })
    vi.useRealTimers()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByLabelText('状态').textContent).toBe('saved'))
    expect(screen.getByLabelText('版本').textContent).toBe('1:2')
  })

  it('saves immediately with Ctrl+S', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(response({
      data: { version: 1, contentHash: 'hash', savedAt: '2026-09-20T00:00:00Z' }, message: 'ok', status: 200,
    })))
    vi.stubGlobal('fetch', fetchMock)
    render(<SaveHarness />)

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByLabelText('状态').textContent).toBe('saved'))
  })

  it('retries a retained draft when the browser comes back online', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('网络不可用'))
      .mockResolvedValueOnce(response({ data: { version: 1, contentHash: 'hash', savedAt: '2026-09-20T00:00:00Z' }, message: 'ok', status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SaveHarness />)

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => expect(screen.getByLabelText('状态').textContent).toBe('failed'))
    window.dispatchEvent(new Event('online'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByLabelText('状态').textContent).toBe('saved'))
  })
})
