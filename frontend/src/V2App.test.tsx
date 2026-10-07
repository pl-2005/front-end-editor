import { act, fireEvent, render as renderUI, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { clearAuth, setCredentials } from './api/auth'
vi.mock('./editor/v2/ProjectWorkspace', () => ({
  default: () => <section aria-label="项目协作工作区" />,
}))

const user = {
  id: 4,
  username: 'member',
  email: 'member@example.test',
  displayName: 'Member',
  avatarColor: '#6366F1',
}
const ok = (data: unknown) =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
const render = (ui: ReactElement) =>
  renderUI(<ConfigProvider theme={{ token: { motion: false } }}>{ui}</ConfigProvider>)

describe('V2 routes', () => {
  afterEach(() => {
    vi.useRealTimers()
    clearAuth()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
  })

  it('lets a member create a project without submitting browser files or a revision', async () => {
    window.history.replaceState(null, '', '/teams/9')
    setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
    const project = {
      id: 17,
      name: 'New project',
      description: null,
      template: 'vanilla',
      entry: '/index.html',
      stateVersion: 1,
      createdAt: '2026-10-04T00:00:00Z',
      updatedAt: '2026-10-04T00:00:00Z',
      collaboration: {
        collaborationMode: 'YJS',
        epoch: 1,
        generation: 1,
        contentHash: 'hash',
        size: 500,
        contentType: 'application/octet-stream',
      },
    }
    const fetcher = vi.fn((path: string, init?: RequestInit) => {
      if (path === '/api/teams/9')
        return Promise.resolve(ok({ id: 9, name: 'Team', joinPolicy: 'REQUEST' }))
      if (path === '/api/teams/9/members')
        return Promise.resolve(
          ok([{ userId: 4, username: 'member', displayName: 'Member', role: 'MEMBER' }]),
        )
      if (path === '/api/teams/9/projects' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({
          name: 'New project',
          template: 'vanilla',
          entry: '/index.html',
        })
        return Promise.resolve(ok(project))
      }
      if (path === '/api/teams/9/projects?size=100')
        return Promise.resolve(ok({ items: [], totalElements: 0 }))
      if (path === '/api/teams/9/projects/17') return Promise.resolve(ok(project))
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByRole('heading', { name: 'Team' })
    fireEvent.change(screen.getByRole('textbox', { name: '项目名称' }), {
      target: { value: 'New project' },
    })
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))
    await screen.findByRole('heading', { name: 'New project' })
    expect(screen.getByRole('button', { name: '删除' }).hasAttribute('disabled')).toBe(false)
    expect(
      fetcher.mock.calls.every(
        ([path]) => !path.includes('snapshot') && !path.includes('revision'),
      ),
    ).toBe(true)
  })

  it('retries the reserved project after initialization fails', async () => {
    window.history.replaceState(null, '', '/teams/9')
    setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
    const project = {
      id: 18,
      name: 'Retry project',
      stateVersion: 1,
      collaboration: { generation: 1 },
    }
    const fetcher = vi.fn((path: string, init?: RequestInit) => {
      if (path === '/api/teams/9')
        return Promise.resolve(ok({ id: 9, name: 'Team', joinPolicy: 'REQUEST' }))
      if (path === '/api/teams/9/members')
        return Promise.resolve(
          ok([{ userId: 4, username: 'member', displayName: 'Member', role: 'MEMBER' }]),
        )
      if (path === '/api/teams/9/projects?size=100')
        return Promise.resolve(ok({ items: [], totalElements: 0 }))
      if (path === '/api/teams/9/projects' && init?.method === 'POST')
        return Promise.resolve(
          new Response(JSON.stringify({ code: 'COLLAB_INITIALIZATION_FAILED' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json', 'X-Initializing-Project': '18' },
          }),
        )
      if (path === '/api/teams/9/projects/18/initialize') {
        expect(init?.method).toBe('POST')
        return Promise.resolve(ok(project))
      }
      if (path === '/api/teams/9/projects/18') return Promise.resolve(ok(project))
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByRole('heading', { name: 'Team' })
    fireEvent.change(screen.getByRole('textbox', { name: '项目名称' }), {
      target: { value: 'Retry project' },
    })
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))
    fireEvent.click(await screen.findByRole('button', { name: '重试项目初始化' }))
    await screen.findByRole('heading', { name: 'Retry project' })
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/teams/9/projects')).toHaveLength(1)
  })

  it('only renames a project after a valid name is confirmed in the dialog', async () => {
    window.history.replaceState(null, '', '/teams/9/projects/17')
    setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
    const project = {
      id: 17,
      name: 'Original',
      description: null,
      template: 'vanilla',
      stateVersion: 1,
      collaboration: { epoch: 1, generation: 1 },
    }
    const fetcher = vi.fn((path: string, init?: RequestInit) => {
      if (path === '/api/teams/9/projects/17' && init?.method === 'PUT') {
        return Promise.resolve(ok({ ...project, name: 'Renamed', stateVersion: 2 }))
      }
      if (path === '/api/teams/9/projects/17') return Promise.resolve(ok(project))
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByRole('heading', { name: 'Original' })
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    fireEvent.click(await screen.findByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    fireEvent.change(await screen.findByRole('textbox', { name: '新的项目名称' }), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
    fireEvent.change(screen.getByRole('textbox', { name: '新的项目名称' }), {
      target: { value: ' Renamed ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    await screen.findByRole('heading', { name: 'Renamed' })
    const update = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')![1]!
    expect(JSON.parse(String(update.body)).name).toBe('Renamed')
    expect(new Headers(update.headers).get('If-Match')).toBe('"project-17-1"')
  })

  it('returns to login after registration without logging in', async () => {
    window.history.replaceState(null, '', '/register')
    const fetcher = vi.fn((path: string, init?: RequestInit) => {
      void init
      expect(path).toBe('/api/auth/register')
      return Promise.resolve(ok(user))
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: '用户名' }), {
      target: { value: 'member' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: /邮箱/ }), {
      target: { value: 'member@example.test' },
    })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'long-password' } })
    fireEvent.click(screen.getByRole('button', { name: '注册' }))
    await screen.findByRole('heading', { name: '登录' })
    expect(window.location.pathname).toBe('/login')
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('/api/auth/register')
  })

  it('keeps a global registration error across navigation until manually dismissed', async () => {
    window.history.replaceState(null, '', '/register')
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ message: '请求冲突' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    )
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: '用户名' }), {
      target: { value: 'member' },
    })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'long-password' } })
    fireEvent.click(screen.getByRole('button', { name: '注册' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('link', { name: '前往登录' }))
    expect(screen.getByRole('heading', { name: '登录' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('请求冲突')
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps a global login error across navigation until manually dismissed', async () => {
    window.history.replaceState(null, '', '/login')
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ message: '登录失败' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    )
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: '用户名或邮箱' }), {
      target: { value: 'member' },
    })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'long-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('link', { name: '创建账号' }))
    expect(screen.getByRole('heading', { name: '注册账号' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('登录失败')
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('retire old invitation links and clear their fragments', async () => {
    window.history.replaceState(null, '', '/invite#token=secret-invite')
    setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    expect(window.location.hash).toBe('')
    expect(screen.getByRole('heading', { name: '旧邀请链接已停用' })).toBeTruthy()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('shows an incoming invitation and accepts it by ID', async () => {
    window.history.replaceState(null, '', '/invitations')
    setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
    const fetcher = vi.fn((path: string, init?: RequestInit) => {
      if (path === '/api/teams/invitations/me')
        return Promise.resolve(
          ok([{ id: 12, teamId: 9, teamName: 'Team', expiresAt: '2030-01-01T00:00:00Z' }]),
        )
      if (path === '/api/teams/invitations/12/accept') {
        expect(init?.method).toBe('POST')
        expect(init?.body).toBeUndefined()
        return Promise.resolve(
          ok({ id: 9, name: 'Team', description: null, joinPolicy: 'REQUEST' }),
        )
      }
      if (path === '/api/teams/9')
        return Promise.resolve(
          ok({ id: 9, name: 'Team', description: null, joinPolicy: 'REQUEST' }),
        )
      if (path === '/api/teams/9/members')
        return Promise.resolve(
          ok([{ userId: 4, username: 'member', displayName: 'Member', role: 'MEMBER' }]),
        )
      if (path.startsWith('/api/teams/9/projects'))
        return Promise.resolve(
          ok({ items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 }),
        )
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByRole('heading', { name: 'Team' })
    fireEvent.click(screen.getByRole('button', { name: '接受' }))
    await waitFor(() => expect(window.location.pathname).toBe('/teams/9'))
    expect(
      fetcher.mock.calls.filter(([path]) => path === '/api/teams/invitations/12/accept'),
    ).toHaveLength(1)
  })

  it('lets recipients reject an invitation', async () => {
    window.history.replaceState(null, '', '/invitations')
    setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
    const fetcher = vi.fn((path: string, init?: RequestInit) => {
      if (path === '/api/teams/invitations/me')
        return Promise.resolve(
          ok([{ id: 12, teamId: 9, teamName: 'Team', expiresAt: '2030-01-01T00:00:00Z' }]),
        )
      if (path === '/api/teams/invitations/12/reject') {
        expect(init?.method).toBe('POST')
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByRole('heading', { name: 'Team' })
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))
    await screen.findByText('暂无待处理邀请。')
    expect(
      fetcher.mock.calls.filter(([path]) => path === '/api/teams/invitations/12/reject'),
    ).toHaveLength(1)
  })

  it('lets owners find multiple users by a partial username and invite the chosen account', async () => {
    window.history.replaceState(null, '', '/teams/9')
    setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
    const team = { id: 9, name: 'Team', description: null, joinPolicy: 'REQUEST' }
    const fetcher = vi.fn((path: string, init?: RequestInit) => {
      if (path === '/api/teams/9') return Promise.resolve(ok(team))
      if (path === '/api/teams/9/members')
        return Promise.resolve(
          ok([{ userId: 4, username: 'member', displayName: 'Member', role: 'OWNER' }]),
        )
      if (path.startsWith('/api/teams/9/projects'))
        return Promise.resolve(
          ok({ items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 }),
        )
      if (path === '/api/teams/9/join-requests') return Promise.resolve(ok([]))
      if (path === '/api/teams/9/invitees/search?query=ali')
        return Promise.resolve(
          ok([
            { userId: 8, username: 'alice', displayName: 'Alice' },
            { userId: 10, username: 'alina', displayName: 'Alina' },
          ]),
        )
      if (path === '/api/teams/9/invitations' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ userId: 8 })
        return Promise.resolve(
          ok({
            id: 12,
            inviteeUserId: 8,
            username: 'alice',
            email: null,
            status: 'PENDING',
            expiresAt: '2030-01-01T00:00:00Z',
          }),
        )
      }
      if (path === '/api/teams/9/invitations') return Promise.resolve(ok([]))
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByRole('heading', { name: '邀请成员' })
    fireEvent.change(screen.getByRole('textbox', { name: '用户名或邮箱' }), {
      target: { value: 'ali' },
    })
    fireEvent.click(screen.getByRole('button', { name: '查找用户' }))
    await screen.findByText('已找到：Alice（@alice）')
    expect(screen.getByText('已找到：Alina（@alina）')).toBeTruthy()
    expect(
      fetcher.mock.calls.some(
        ([path, init]) => path === '/api/teams/9/invitations' && init?.method === 'POST',
      ),
    ).toBe(false)
    fireEvent.click(screen.getAllByRole('button', { name: '确认发送邀请' })[0])
    await screen.findByText('邀请已发送，受邀人可在“我的邀请”中处理。')
    expect(
      fetcher.mock.calls.filter(
        ([path, init]) => path === '/api/teams/9/invitations' && init?.method === 'POST',
      ),
    ).toHaveLength(1)
  })

  it('shows no-user feedback without sending an invitation', async () => {
    window.history.replaceState(null, '', '/teams/9')
    setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
    const fetcher = vi.fn((path: string, init?: RequestInit) => {
      void init
      if (path === '/api/teams/9')
        return Promise.resolve(
          ok({ id: 9, name: 'Team', description: null, joinPolicy: 'REQUEST' }),
        )
      if (path === '/api/teams/9/members')
        return Promise.resolve(
          ok([{ userId: 4, username: 'member', displayName: 'Member', role: 'OWNER' }]),
        )
      if (path.startsWith('/api/teams/9/projects'))
        return Promise.resolve(
          ok({ items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 }),
        )
      if (path === '/api/teams/9/join-requests' || path === '/api/teams/9/invitations')
        return Promise.resolve(ok([]))
      if (path === '/api/teams/9/invitees/search?query=absent%40example.test')
        return Promise.resolve(ok([]))
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByRole('heading', { name: '邀请成员' })
    fireEvent.change(screen.getByRole('textbox', { name: '用户名或邮箱' }), {
      target: { value: 'absent@example.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: '查找用户' }))
    await screen.findByText('没有找到可邀请的用户，请尝试其他关键词。')
    expect(screen.queryByRole('button', { name: '确认发送邀请' })).toBeNull()
    expect(window.location.pathname).toBe('/teams/9')
    expect(
      fetcher.mock.calls.some(
        ([path, init]) => path === '/api/teams/9/invitations' && init?.method === 'POST',
      ),
    ).toBe(false)
  })

  it.each(['用户已是团队成员', '已有待处理邀请'])(
    'shows the invitation conflict reason: %s',
    async (reason) => {
      window.history.replaceState(null, '', '/teams/9')
      setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
      const fetcher = vi.fn((path: string, init?: RequestInit) => {
        if (path === '/api/teams/9')
          return Promise.resolve(
            ok({ id: 9, name: 'Team', description: null, joinPolicy: 'REQUEST' }),
          )
        if (path === '/api/teams/9/members')
          return Promise.resolve(
            ok([{ userId: 4, username: 'member', displayName: 'Member', role: 'OWNER' }]),
          )
        if (path.startsWith('/api/teams/9/projects'))
          return Promise.resolve(ok({ items: [], totalElements: 0 }))
        if (path === '/api/teams/9/join-requests') return Promise.resolve(ok([]))
        if (path === '/api/teams/9/invitees/search?query=alice')
          return Promise.resolve(ok([{ userId: 8, username: 'alice', displayName: 'Alice' }]))
        if (path === '/api/teams/9/invitations' && init?.method === 'POST')
          return Promise.resolve(
            new Response(JSON.stringify({ code: 'TEAM_STATE_CONFLICT', message: reason }), {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            }),
          )
        if (path === '/api/teams/9/invitations') return Promise.resolve(ok([]))
        throw new Error(`Unexpected request: ${path}`)
      })
      vi.stubGlobal('fetch', fetcher)
      render(<App />)
      await screen.findByRole('heading', { name: '邀请成员' })
      fireEvent.change(screen.getByRole('textbox', { name: '用户名或邮箱' }), {
        target: { value: 'alice' },
      })
      fireEvent.click(screen.getByRole('button', { name: '查找用户' }))
      fireEvent.click(await screen.findByRole('button', { name: '确认发送邀请' }))
      expect((await screen.findByRole('alert')).textContent).toContain(reason)
      expect(screen.queryByText('内容已变化，请重新加载后再试。')).toBeNull()
      expect(screen.queryByText('邀请已发送，受邀人可在“我的邀请”中处理。')).toBeNull()
    },
  )

  it('paginates discovery on the server and resets searches without showing stale responses', async () => {
    window.history.replaceState(null, '', '/discover')
    setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
    const pageData = (page: number) => ({
      content: Array.from({ length: 10 }, (_, index) => ({
        id: page * 10 + index + 1,
        name: `Team ${page * 10 + index + 1}`,
        description: null,
        joinPolicy: 'REQUEST',
      })),
      number: page,
      size: 10,
      totalElements: 21,
      totalPages: 3,
    })
    let resolveLastPage!: (response: Response) => void
    const lastPage = new Promise<Response>((resolve) => {
      resolveLastPage = resolve
    })
    const fetcher = vi.fn((path: string) => {
      if (path === '/api/teams/discover?query=&page=0&size=10')
        return Promise.resolve(ok(pageData(0)))
      if (path === '/api/teams/discover?query=&page=1&size=10')
        return Promise.resolve(ok(pageData(1)))
      if (path === '/api/teams/discover?query=&page=2&size=10') return lastPage
      if (path === '/api/teams/discover?query=Alpha%20%26%20Beta&page=0&size=10')
        return Promise.resolve(
          ok({
            content: [{ id: 50, name: 'Alpha & Beta', description: null, joinPolicy: 'REQUEST' }],
            number: 0,
            size: 10,
            totalElements: 1,
            totalPages: 1,
          }),
        )
      if (path === '/api/teams/join-requests/me')
        return Promise.resolve(ok([{ teamId: 11, status: 'PENDING' }]))
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByText('Team 1')
    expect(screen.getByText('共 21 个团队')).toBeTruthy()
    fireEvent.click(screen.getByTitle('2'))
    await screen.findByText('Team 11')
    expect(screen.queryByText('Team 1')).toBeNull()
    expect(screen.getByRole('button', { name: '撤回申请' })).toBeTruthy()
    fireEvent.click(screen.getByTitle('3'))
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        '/api/teams/discover?query=&page=2&size=10',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    )
    expect(screen.queryByText('Team 11')).toBeNull()
    expect(screen.getByPlaceholderText('搜索允许申请的团队')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '搜索' })).toBeNull()
    expect(screen.queryByRole('button', { name: '重置' })).toBeNull()
    vi.useFakeTimers()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索允许申请的团队' }), {
      target: { value: 'Alpha' },
    })
    act(() => vi.advanceTimersByTime(200))
    fireEvent.change(screen.getByRole('textbox', { name: '搜索允许申请的团队' }), {
      target: { value: '  Alpha & Beta  ' },
    })
    act(() => vi.advanceTimersByTime(299))
    expect(fetcher.mock.calls.some(([path]) => path.includes('query=Alpha'))).toBe(false)
    act(() => vi.advanceTimersByTime(1))
    vi.useRealTimers()
    await screen.findByText('Alpha & Beta')
    expect(screen.getByText('共 1 个团队')).toBeTruthy()
    expect(screen.getByTitle('1').className).toContain('ant-pagination-item-active')
    await act(async () => {
      resolveLastPage(ok({ ...pageData(2), content: [pageData(2).content[0]] }))
    })
    expect(screen.queryByText('Team 21')).toBeNull()
    expect(screen.getByText('Alpha & Beta')).toBeTruthy()
    fireEvent.click(document.querySelector<HTMLButtonElement>('.ant-input-clear-icon')!)
    await screen.findByText('Team 1')
    expect(
      (screen.getByRole('textbox', { name: '搜索允许申请的团队' }) as HTMLInputElement).value,
    ).toBe('')
    expect(screen.getByText('共 21 个团队')).toBeTruthy()
  })

  it('defaults to ten teams and resets to page one when changing page size', async () => {
    window.history.replaceState(null, '', '/discover')
    setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
    const fetcher = vi.fn((path: string) => {
      if (path === '/api/teams/join-requests/me') return Promise.resolve(ok([]))
      if (path.startsWith('/api/teams/discover?')) {
        const params = new URL(path, 'http://localhost').searchParams
        const page = Number(params.get('page'))
        const size = Number(params.get('size'))
        return Promise.resolve(
          ok({
            content: Array.from({ length: Math.min(size, 35 - page * size) }, (_, index) => ({
              id: page * size + index + 1,
              name: `Sized Team ${page * size + index + 1}`,
              description: null,
              joinPolicy: 'REQUEST',
            })),
            number: page,
            size,
            totalElements: 35,
            totalPages: Math.ceil(35 / size),
          }),
        )
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByText('Sized Team 10')
    expect(screen.queryByText('Sized Team 11')).toBeNull()
    fireEvent.click(screen.getByTitle('2'))
    await screen.findByText('Sized Team 11')
    fireEvent.mouseDown(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByText('20 条/页'))
    await screen.findByText('Sized Team 1')
    expect(screen.getByText('Sized Team 20')).toBeTruthy()
    expect(screen.getByTitle('1').className).toContain('ant-pagination-item-active')
    expect(fetcher).toHaveBeenCalledWith(
      '/api/teams/discover?query=&page=0&size=20',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    fireEvent.click(screen.getByTitle('2'))
    await screen.findByText('Sized Team 35')
    expect(fetcher).toHaveBeenCalledWith(
      '/api/teams/discover?query=&page=1&size=20',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('shows the member conflict when applying to a team the user already belongs to', async () => {
    window.history.replaceState(null, '', '/discover')
    setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string, init?: RequestInit) => {
        if (path === '/api/teams/discover?query=&page=0&size=10')
          return Promise.resolve(
            ok({
              content: [{ id: 9, name: 'Team', description: null, joinPolicy: 'REQUEST' }],
              totalElements: 1,
            }),
          )
        if (path === '/api/teams/join-requests/me') return Promise.resolve(ok([]))
        if (path === '/api/teams/9/join-requests' && init?.method === 'POST')
          return Promise.resolve(
            new Response(JSON.stringify({ code: 'TEAM_STATE_CONFLICT', message: '已是团队成员' }), {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            }),
          )
        throw new Error(`Unexpected request: ${path}`)
      }),
    )
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '申请加入' }))
    expect((await screen.findByRole('alert')).textContent).toContain('已是团队成员')
    expect(screen.queryByText('内容已变化，请重新加载后再试。')).toBeNull()
    expect(screen.queryByText('等待审批')).toBeNull()
    expect(screen.queryByRole('button', { name: '撤回申请' })).toBeNull()
  })

  it.each([
    [403, 'ACCESS_DENIED', '团队不接受加入申请', '团队不接受加入申请'],
    [404, 'USER_NOT_FOUND', '该账号已停用', '该账号已停用'],
    [409, 'PROJECT_STATE_CONFLICT', '项目已被其他成员修改', '项目已被其他成员修改'],
    [429, 'RATE_LIMITED', '请等待一分钟后重试', '请等待一分钟后重试'],
    [410, 'INVITATION_EXPIRED', '邀请已过期，请重新获取邀请', '邀请已过期，请重新获取邀请'],
    [503, 'COLLAB_CREATION_DISABLED', '管理员已暂停创建项目', '管理员已暂停创建项目'],
    [403, 'ACCESS_DENIED', '  ', '没有执行此操作的权限。'],
    [409, 'PROJECT_STATE_CONFLICT', undefined, '内容已变化，请重新加载后再试。'],
  ])(
    'prefers the API message or uses the fallback for %s / %s',
    async (status, code, responseMessage, expected) => {
      window.history.replaceState(null, '', '/discover')
      setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
      vi.stubGlobal(
        'fetch',
        vi.fn((path: string) => {
          if (path === '/api/teams/discover?query=&page=0&size=10')
            return Promise.resolve(
              new Response(JSON.stringify({ code, message: responseMessage }), {
                status,
                headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
              }),
            )
          if (path === '/api/teams/join-requests/me') return Promise.resolve(ok([]))
          throw new Error(`Unexpected request: ${path}`)
        }),
      )
      render(<App />)
      expect((await screen.findByRole('alert')).textContent).toContain(expected)
    },
  )

  it('shows member list but hides owner controls from members', async () => {
    window.history.replaceState(null, '', '/teams/9')
    setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
    const fetcher = vi.fn((path: string) => {
      if (path === '/api/teams/9')
        return Promise.resolve(
          ok({ id: 9, name: 'Team', description: null, joinPolicy: 'REQUEST' }),
        )
      if (path === '/api/teams/9/members')
        return Promise.resolve(
          ok([{ userId: 4, username: 'member', displayName: 'Member', role: 'MEMBER' }]),
        )
      if (path.startsWith('/api/teams/9/projects'))
        return Promise.resolve(
          ok({ items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 }),
        )
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByRole('heading', { name: 'Team' })
    expect(screen.getByText('@member · 成员')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '邀请成员' })).toBeNull()
    expect(screen.queryByRole('button', { name: '转移所有权' })).toBeNull()
    await waitFor(() =>
      expect(fetcher.mock.calls.every(([path]) => !String(path).includes('invitations'))).toBe(
        true,
      ),
    )
  })

  it('clears a removed member view after the next denied action', async () => {
    window.history.replaceState(null, '', '/teams/9')
    setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
    const fetcher = vi.fn((path: string, init?: RequestInit) => {
      if (path === '/api/teams/9')
        return Promise.resolve(
          ok({ id: 9, name: 'Team', description: null, joinPolicy: 'REQUEST' }),
        )
      if (path === '/api/teams/9/members/me' && init?.method === 'DELETE')
        return Promise.resolve(
          new Response(JSON.stringify({ message: '团队不存在' }), { status: 404 }),
        )
      if (path === '/api/teams/9/members')
        return Promise.resolve(
          ok([{ userId: 4, username: 'member', displayName: 'Member', role: 'MEMBER' }]),
        )
      if (path.startsWith('/api/teams/9/projects'))
        return Promise.resolve(
          ok({ items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 }),
        )
      if (path === '/api/teams?size=100')
        return Promise.resolve(
          ok({ content: [], number: 0, size: 100, totalElements: 0, totalPages: 0 }),
        )
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByRole('heading', { name: 'Team' })
    fireEvent.click(screen.getByRole('button', { name: '退出团队' }))
    await screen.findByRole('dialog', {
      name: '确定退出团队“Team”？退出后将无法访问该团队的项目。',
    })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(fetcher.mock.calls.some(([path]) => path === '/api/teams/9/members/me')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '退出团队' }))
    fireEvent.click(await screen.findByRole('button', { name: '确定' }))
    await screen.findByRole('heading', { name: '我的团队' })
    expect(screen.queryByRole('heading', { name: 'Team' })).toBeNull()
  })
})
