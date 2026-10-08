import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { WorkspaceApp } from './LegacyWorkspaceApp'
import { clearAuth, setCredentials } from './api/auth'
import { putDraft } from './persistence/drafts'

vi.mock('@codesandbox/sandpack-react', async () => {
  const React = await import('react')
  const Context = React.createContext<{
    files: Record<string, { code: string }>
    setFiles: React.Dispatch<React.SetStateAction<Record<string, { code: string }>>>
    activeFile: string
    setActiveFile: React.Dispatch<React.SetStateAction<string>>
  } | null>(null)

  function useRuntime() {
    const runtime = React.useContext(Context)
    if (!runtime) throw new Error('Missing test Sandpack provider')
    return runtime
  }

  return {
    SandpackProvider: ({
      files,
      customSetup,
      template,
      options,
      children,
    }: {
      files: Record<string, { code: string }>
      customSetup: object
      template: string
      options: { autorun?: boolean }
      children: ReactNode
    }) => {
      const [currentFiles, setFiles] = React.useState(files)
      const [activeFile, setActiveFile] = React.useState(Object.keys(files)[0])
      const mounted = React.useRef(false)
      React.useEffect(() => {
        if (mounted.current) setActiveFile(Object.keys(files)[0])
        else mounted.current = true
      }, [customSetup, files])
      return (
        <Context.Provider value={{ files: currentFiles, setFiles, activeFile, setActiveFile }}>
          <div
            data-testid="sandpack-provider"
            data-template={template}
            data-autorun={String(options.autorun)}
          >
            {children}
          </div>
        </Context.Provider>
      )
    },
    useSandpack: () => {
      const runtime = useRuntime()
      return {
        sandpack: {
          files: runtime.files,
          activeFile: runtime.activeFile,
          openFile: runtime.setActiveFile,
          addFile: (path: string, code: string) =>
            runtime.setFiles((files) => ({ ...files, [path]: { code } })),
          deleteFile: (path: string) =>
            runtime.setFiles((files) =>
              Object.fromEntries(Object.entries(files).filter(([key]) => key !== path)),
            ),
        },
      }
    },
    SandpackCodeEditor: () => {
      const runtime = useRuntime()
      return (
        <button
          type="button"
          onClick={() =>
            runtime.setFiles((files) => ({
              ...files,
              [runtime.activeFile]: { code: `${files[runtime.activeFile]?.code ?? ''}!` },
            }))
          }
        >
          编辑当前文件 {runtime.activeFile}
        </button>
      )
    },
    SandpackLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SandpackPreview: () => <div>预览</div>,
    SandpackConsole: ({ standalone }: { standalone?: boolean }) => (
      <div data-testid="sandpack-console" data-standalone={String(Boolean(standalone))}>
        控制台输出
      </div>
    ),
  }
})

describe('V2 login landing', () => {
  afterEach(() => {
    clearAuth()
    vi.unstubAllGlobals()
  })

  it('loads teams without requesting legacy projects after login', async () => {
    window.history.replaceState(null, '', '/teams')
    const fetchMock = vi.fn((path: string) => {
      expect(path).toBe('/api/teams?size=100')
      return Promise.resolve(
        envelope({ content: [], number: 0, size: 100, totalElements: 0, totalPages: 0 }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    setCredentials({
      user: {
        id: 1,
        username: 'tester',
        email: null,
        displayName: 'Tester',
        avatarColor: '#6366F1',
      },
      accessToken: 'test-access-token',
      expiresIn: 600,
    })

    render(<App />)

    expect(screen.getByRole('heading', { name: '我的团队' })).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls.every(([path]) => String(path).startsWith('/api/teams'))).toBe(true)
  })
})

const project = (id: number, name: string, version: number) => ({
  id,
  name,
  description: null,
  template: 'vanilla',
  entry: '/index.html',
  version,
  stateVersion: 0,
  files: { '/index.html': { code: `<h1>${name}</h1>` } },
  createdAt: '2026-09-20T00:00:00Z',
  updatedAt: '2026-09-20T00:00:00Z',
})

const envelope = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data, message: 'ok', status }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('App project coordination', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    setCredentials({
      user: {
        id: 1,
        username: 'tester',
        email: null,
        displayName: 'Tester',
        avatarColor: '#6366F1',
      },
      accessToken: 'test-access-token',
      expiresIn: 600,
    })
  })

  afterEach(() => {
    clearAuth()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses the Vite runtime with automatic startup', async () => {
    const first = project(1, '项目 A', 0)
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input)
        if (url.includes('?size=100'))
          return Promise.resolve(
            envelope({ items: [first], page: 0, size: 100, totalElements: 1, totalPages: 1 }),
          )
        if (url === '/api/projects/1') return Promise.resolve(envelope(first))
        throw new Error(`Unexpected request: ${url}`)
      }),
    )

    render(<WorkspaceApp />)

    const provider = await screen.findByTestId('sandpack-provider')
    expect(provider.getAttribute('data-template')).toBe('vite')
    expect(provider.getAttribute('data-autorun')).toBe('true')
    expect(screen.getByTestId('sandpack-console').getAttribute('data-standalone')).toBe('false')
  })

  it('does not apply a previous project save result to the currently open project', async () => {
    const first = project(1, '项目 A', 0)
    const second = project(2, '项目 B', 3)
    const saveResult = deferred<Response>()

    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('?size=100'))
        return Promise.resolve(
          envelope({ items: [first, second], page: 0, size: 100, totalElements: 2, totalPages: 1 }),
        )
      if (url === '/api/projects/1/snapshot' && init?.method === 'PUT') return saveResult.promise
      if (url === '/api/projects/1') return Promise.resolve(envelope(first))
      if (url === '/api/projects/2') return Promise.resolve(envelope(second))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WorkspaceApp />)
    await screen.findByText('项目 A', { selector: '.app-header strong' })

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /^编辑当前文件/ }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url) === '/api/projects/1/snapshot' && init?.method === 'PUT',
      ),
    ).toBe(true)
    vi.useRealTimers()

    fireEvent.click(screen.getByRole('button', { name: /项目 B/ }))
    await screen.findByText('项目 B', { selector: '.app-header strong' })

    await act(async () => {
      saveResult.resolve(
        envelope({
          version: 1,
          stateVersion: 1,
          contentHash: 'hash',
          savedAt: '2026-09-20T00:00:00Z',
        }),
      )
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.getByText('版本 3')).toBeTruthy())
  })

  it('keeps the selected file active after a save updates the project version', async () => {
    const first = {
      ...project(1, '项目 A', 0),
      files: {
        '/index.html': { code: '<h1>项目 A</h1>' },
        '/styles.css': { code: 'body {}' },
      },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('?size=100'))
          return Promise.resolve(
            envelope({ items: [first], page: 0, size: 100, totalElements: 1, totalPages: 1 }),
          )
        if (url === '/api/projects/1') return Promise.resolve(envelope(first))
        if (url === '/api/projects/1/snapshot' && init?.method === 'PUT') {
          return Promise.resolve(
            envelope({
              version: 1,
              stateVersion: 1,
              contentHash: 'hash',
              savedAt: '2026-09-20T00:00:00Z',
            }),
          )
        }
        throw new Error(`Unexpected request: ${url}`)
      }),
    )

    render(<WorkspaceApp />)
    await screen.findByText('项目 A', { selector: '.app-header strong' })

    fireEvent.click(screen.getByRole('button', { name: 'styles.css' }))
    expect(screen.getByRole('button', { name: '编辑当前文件 /styles.css' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '编辑当前文件 /styles.css' }))
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })

    await screen.findByText('已保存 · 版本 1')
    expect(screen.getByRole('button', { name: '编辑当前文件 /styles.css' })).toBeTruthy()
  })

  it('closes, opens, and resizes the console', async () => {
    const first = project(1, '项目 A', 0)
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input)
        if (url.includes('?size=100'))
          return Promise.resolve(
            envelope({ items: [first], page: 0, size: 100, totalElements: 1, totalPages: 1 }),
          )
        if (url === '/api/projects/1') return Promise.resolve(envelope(first))
        throw new Error(`Unexpected request: ${url}`)
      }),
    )

    const { container } = render(<WorkspaceApp />)
    await screen.findByText('项目 A', { selector: '.app-header strong' })

    const workspace = container.querySelector<HTMLElement>('.workspace')
    expect(workspace?.style.getPropertyValue('--console-height')).toBe('190px')

    fireEvent.pointerDown(screen.getByRole('separator', { name: '调整控制台高度' }), {
      button: 0,
      clientY: 500,
    })
    fireEvent.pointerMove(window, { clientY: 450 })
    fireEvent.pointerUp(window)
    expect(workspace?.style.getPropertyValue('--console-height')).toBe('240px')

    fireEvent.click(screen.getByRole('button', { name: '关闭控制台' }))
    expect(screen.queryByText('控制台输出')).toBeNull()
    expect(workspace?.style.getPropertyValue('--console-height')).toBe('34px')

    fireEvent.click(screen.getByRole('button', { name: '打开控制台' }))
    expect(screen.getByText('控制台输出')).toBeTruthy()
    expect(workspace?.style.getPropertyValue('--console-height')).toBe('240px')
  })

  it('keeps the last selected project when an earlier load finishes later', async () => {
    const first = project(1, '项目 A', 0)
    const second = project(2, '项目 B', 3)
    const delayedSecond = deferred<Response>()
    let firstLoadCount = 0

    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input)
        if (url.includes('?size=100'))
          return Promise.resolve(
            envelope({
              items: [first, second],
              page: 0,
              size: 100,
              totalElements: 2,
              totalPages: 1,
            }),
          )
        if (url === '/api/projects/1') {
          firstLoadCount += 1
          return Promise.resolve(envelope(first))
        }
        if (url === '/api/projects/2') return delayedSecond.promise
        throw new Error(`Unexpected request: ${url}`)
      }),
    )

    render(<WorkspaceApp />)
    await screen.findByText('项目 A', { selector: '.app-header strong' })

    fireEvent.click(screen.getByRole('button', { name: /项目 B/ }))
    fireEvent.click(screen.getByRole('button', { name: /项目 A/ }))
    await waitFor(() => expect(firstLoadCount).toBe(2))
    await screen.findByText('项目 A', { selector: '.app-header strong' })

    await act(async () => {
      delayedSecond.resolve(envelope(second))
      await new Promise((resolve) => window.setTimeout(resolve, 20))
    })

    expect(screen.getByText('项目 A', { selector: '.app-header strong' })).toBeTruthy()
  })

  it('restores and saves a draft based on the current server version', async () => {
    const first = project(1, '项目 A', 0)
    await putDraft({
      projectId: 1,
      baseVersion: 0,
      entry: '/index.html',
      files: { '/index.html': { code: '<h1>本地草稿</h1>' } },
      updatedAt: Date.now(),
    })
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('?size=100'))
        return Promise.resolve(
          envelope({ items: [first], page: 0, size: 100, totalElements: 1, totalPages: 1 }),
        )
      if (url === '/api/projects/1' && !init?.method) return Promise.resolve(envelope(first))
      if (url === '/api/projects/1/snapshot' && init?.method === 'PUT')
        return Promise.resolve(
          envelope({
            version: 1,
            stateVersion: 1,
            contentHash: 'draft',
            savedAt: '2026-09-20T00:00:00Z',
          }),
        )
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WorkspaceApp />)
    await screen.findByText('已恢复本地草稿')
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url, init]) => {
          if (String(url) !== '/api/projects/1/snapshot' || init?.method !== 'PUT') return false
          const html = JSON.parse(String(init.body)).files['/index.html'].code as string
          return html === '<h1>本地草稿</h1>'
        }),
      ).toBe(true),
    )
  })

  it('creates a saved copy after a version conflict', async () => {
    const first = project(1, '项目 A', 0)
    const copySummary = { ...project(2, '项目 A 副本', 0) }
    const copyDetails = {
      ...copySummary,
      version: 1,
      files: { '/index.html': { code: '<h1>项目 A</h1>!' } },
    }
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('?size=100'))
        return Promise.resolve(
          envelope({
            items: [first, copySummary],
            page: 0,
            size: 100,
            totalElements: 2,
            totalPages: 1,
          }),
        )
      if (url === '/api/projects/1/snapshot' && init?.method === 'PUT')
        return Promise.resolve(
          new Response(JSON.stringify({ message: '版本冲突', code: 'VERSION_CONFLICT' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      if (url === '/api/projects' && init?.method === 'POST')
        return Promise.resolve(envelope(copySummary, 201))
      if (url === '/api/projects/2/snapshot' && init?.method === 'PUT')
        return Promise.resolve(
          envelope({
            version: 1,
            stateVersion: 1,
            contentHash: 'copy',
            savedAt: '2026-09-20T00:00:00Z',
          }),
        )
      if (url === '/api/projects/2') return Promise.resolve(envelope(copyDetails))
      if (url === '/api/projects/1') return Promise.resolve(envelope(first))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'prompt').mockReturnValue('项目 A 副本')

    render(<WorkspaceApp />)
    await screen.findByText('项目 A', { selector: '.app-header strong' })
    fireEvent.click(screen.getByRole('button', { name: /^编辑当前文件/ }))
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    fireEvent.click(await screen.findByRole('button', { name: '另存副本' }))

    await screen.findByText('项目 A 副本', { selector: '.app-header strong' })
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url) === '/api/projects/2/snapshot' && init?.method === 'PUT',
      ),
    ).toBe(true)
  })

  it('restores a historical revision and reloads the new version', async () => {
    const current = project(1, '项目 A', 2)
    const restored = {
      ...project(1, '项目 A', 3),
      files: { '/index.html': { code: '<h1>旧内容</h1>' } },
    }
    let detailLoads = 0
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('?size=100'))
        return Promise.resolve(
          envelope({ items: [current], page: 0, size: 100, totalElements: 1, totalPages: 1 }),
        )
      if (url === '/api/projects/1/revisions')
        return Promise.resolve(
          envelope([
            {
              version: 2,
              contentHash: 'new',
              sizeBytes: 120,
              createdAt: '2026-09-20T02:00:00Z',
              current: true,
            },
            {
              version: 1,
              contentHash: 'old',
              sizeBytes: 100,
              createdAt: '2026-09-20T01:00:00Z',
              current: false,
            },
          ]),
        )
      if (url === '/api/projects/1/revisions/1/restore' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body)).expectedVersion).toBe(2)
        return Promise.resolve(
          envelope({
            version: 3,
            stateVersion: 3,
            contentHash: 'old',
            savedAt: '2026-09-20T03:00:00Z',
          }),
        )
      }
      if (url === '/api/projects/1') {
        detailLoads += 1
        return Promise.resolve(envelope(detailLoads === 1 ? current : restored))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<WorkspaceApp />)
    await screen.findByText('版本 2')
    fireEvent.click(screen.getByRole('button', { name: '版本历史' }))
    fireEvent.click(await screen.findByRole('button', { name: '恢复' }))

    await screen.findByText('版本 3')
    expect(
      fetchMock.mock.calls.some(([url]) => String(url) === '/api/projects/1/revisions/1/restore'),
    ).toBe(true)
  })
})
