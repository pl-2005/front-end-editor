import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { clearAuth, setCredentials } from './api/auth'
vi.mock('./editor/v2/ProjectWorkspace', () => ({ default: () => <section aria-label="项目协作工作区" /> }))

const user = { id: 4, username: 'member', email: 'member@example.test', displayName: 'Member', avatarColor: '#6366F1' }
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('V2 routes', () => {
  afterEach(() => { clearAuth(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

  it('lets a member create a project without submitting browser files or a revision', async () => {
    window.history.replaceState(null, '', '/teams/9')
    setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
    const project = { id: 17, name: 'New project', description: null, template: 'vanilla', entry: '/index.html', stateVersion: 1,
      createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z',
      collaboration: { collaborationMode: 'YJS', epoch: 1, generation: 1, contentHash: 'hash', size: 500, contentType: 'application/octet-stream' } }
    const fetcher = vi.fn((path: string, init?: RequestInit) => {
      if (path === '/api/teams/9') return Promise.resolve(ok({ id: 9, name: 'Team', joinPolicy: 'REQUEST' }))
      if (path === '/api/teams/9/members') return Promise.resolve(ok([{ userId: 4, username: 'member', displayName: 'Member', role: 'MEMBER' }]))
      if (path === '/api/teams/9/projects' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ name: 'New project', template: 'vanilla', entry: '/index.html' })
        return Promise.resolve(ok(project))
      }
      if (path === '/api/teams/9/projects?size=100') return Promise.resolve(ok({ items: [], totalElements: 0 }))
      if (path === '/api/teams/9/projects/17') return Promise.resolve(ok(project))
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByRole('heading', { name: 'Team' })
    fireEvent.change(screen.getByRole('textbox', { name: '项目名称' }), { target: { value: 'New project' } })
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))
    await screen.findByRole('heading', { name: 'New project' })
    expect(screen.getByRole('button', { name: '删除' }).hasAttribute('disabled')).toBe(true)
    expect(fetcher.mock.calls.every(([path]) => !path.includes('snapshot') && !path.includes('revision'))).toBe(true)
  })

  it('retries the reserved project after initialization fails', async () => {
    window.history.replaceState(null, '', '/teams/9')
    setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
    const project = { id: 18, name: 'Retry project', stateVersion: 1, collaboration: { generation: 1 } }
    const fetcher = vi.fn((path: string, init?: RequestInit) => {
      if (path === '/api/teams/9') return Promise.resolve(ok({ id: 9, name: 'Team', joinPolicy: 'REQUEST' }))
      if (path === '/api/teams/9/members') return Promise.resolve(ok([{ userId: 4, username: 'member', displayName: 'Member', role: 'MEMBER' }]))
      if (path === '/api/teams/9/projects?size=100') return Promise.resolve(ok({ items: [], totalElements: 0 }))
      if (path === '/api/teams/9/projects' && init?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ code: 'COLLAB_INITIALIZATION_FAILED' }), {
        status: 503, headers: { 'Content-Type': 'application/json', 'X-Initializing-Project': '18' },
      }))
      if (path === '/api/teams/9/projects/18/initialize') { expect(init?.method).toBe('POST'); return Promise.resolve(ok(project)) }
      if (path === '/api/teams/9/projects/18') return Promise.resolve(ok(project))
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByRole('heading', { name: 'Team' })
    fireEvent.change(screen.getByRole('textbox', { name: '项目名称' }), { target: { value: 'Retry project' } })
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))
    fireEvent.click(await screen.findByRole('button', { name: '重试项目初始化' }))
    await screen.findByRole('heading', { name: 'Retry project' })
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/teams/9/projects')).toHaveLength(1)
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
    fireEvent.change(screen.getByRole('textbox', { name: '用户名' }), { target: { value: 'member' } })
    fireEvent.change(screen.getByRole('textbox', { name: /邮箱/ }), { target: { value: 'member@example.test' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'long-password' } })
    fireEvent.click(screen.getByRole('button', { name: '注册' }))
    await screen.findByRole('heading', { name: '登录' })
    expect(window.location.pathname).toBe('/login')
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('/api/auth/register')
  })

  it('clears a registration error when going to login', async () => {
    window.history.replaceState(null, '', '/register')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ message: '请求冲突' }), { status: 409, headers: { 'Content-Type': 'application/json' } }))))
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: '用户名' }), { target: { value: 'member' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'long-password' } })
    fireEvent.click(screen.getByRole('button', { name: '注册' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('link', { name: '前往登录' }))
    expect(screen.getByRole('heading', { name: '登录' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('clears a login error when going to registration', async () => {
    window.history.replaceState(null, '', '/login')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ message: '登录失败' }), { status: 401, headers: { 'Content-Type': 'application/json' } }))))
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: '用户名或邮箱' }), { target: { value: 'member' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'long-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('link', { name: '创建账号' }))
    expect(screen.getByRole('heading', { name: '注册账号' })).toBeTruthy()
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
      if (path === '/api/teams/invitations/me') return Promise.resolve(ok([{ id: 12, teamId: 9, teamName: 'Team', expiresAt: '2030-01-01T00:00:00Z' }]))
      if (path === '/api/teams/invitations/12/accept') {
        expect(init?.method).toBe('POST')
        expect(init?.body).toBeUndefined()
        return Promise.resolve(ok({ id: 9, name: 'Team', description: null, joinPolicy: 'REQUEST' }))
      }
      if (path === '/api/teams/9') return Promise.resolve(ok({ id: 9, name: 'Team', description: null, joinPolicy: 'REQUEST' }))
      if (path === '/api/teams/9/members') return Promise.resolve(ok([{ userId: 4, username: 'member', displayName: 'Member', role: 'MEMBER' }]))
      if (path.startsWith('/api/teams/9/projects')) return Promise.resolve(ok({ items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 }))
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByRole('heading', { name: 'Team' })
    fireEvent.click(screen.getByRole('button', { name: '接受' }))
    await waitFor(() => expect(window.location.pathname).toBe('/teams/9'))
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/teams/invitations/12/accept')).toHaveLength(1)
  })

  it('lets recipients reject an invitation', async () => {
    window.history.replaceState(null, '', '/invitations')
    setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
    const fetcher = vi.fn((path: string, init?: RequestInit) => {
      if (path === '/api/teams/invitations/me') return Promise.resolve(ok([{ id: 12, teamId: 9, teamName: 'Team', expiresAt: '2030-01-01T00:00:00Z' }]))
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
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/teams/invitations/12/reject')).toHaveLength(1)
  })

  it('lets owners invite by username', async () => {
    window.history.replaceState(null, '', '/teams/9')
    setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
    const team = { id: 9, name: 'Team', description: null, joinPolicy: 'REQUEST' }
    const fetcher = vi.fn((path: string, init?: RequestInit) => {
      if (path === '/api/teams/9') return Promise.resolve(ok(team))
      if (path === '/api/teams/9/members') return Promise.resolve(ok([{ userId: 4, username: 'member', displayName: 'Member', role: 'OWNER' }]))
      if (path.startsWith('/api/teams/9/projects')) return Promise.resolve(ok({ items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 }))
      if (path === '/api/teams/9/join-requests') return Promise.resolve(ok([]))
      if (path === '/api/teams/9/invitees/lookup?identifier=alice') return Promise.resolve(ok({ userId: 8, username: 'alice', displayName: 'Alice' }))
      if (path === '/api/teams/9/invitations' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ userId: 8 })
        return Promise.resolve(ok({ id: 12, inviteeUserId: 8, username: 'alice', email: null, status: 'PENDING', expiresAt: '2030-01-01T00:00:00Z' }))
      }
      if (path === '/api/teams/9/invitations') return Promise.resolve(ok([]))
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByRole('heading', { name: '邀请成员' })
    fireEvent.change(screen.getByRole('textbox', { name: '用户名或邮箱' }), { target: { value: 'alice' } })
    fireEvent.click(screen.getByRole('button', { name: '查找用户' }))
    await screen.findByText('已找到：Alice（@alice）')
    expect(fetcher.mock.calls.some(([path, init]) => path === '/api/teams/9/invitations' && init?.method === 'POST')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '确认发送邀请' }))
    await screen.findByText('邀请已发送，受邀人可在“我的邀请”中处理。')
    expect(fetcher.mock.calls.filter(([path, init]) => path === '/api/teams/9/invitations' && init?.method === 'POST')).toHaveLength(1)
  })

  it('shows no-user feedback without sending an invitation', async () => {
    window.history.replaceState(null, '', '/teams/9')
    setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
    const fetcher = vi.fn((path: string, init?: RequestInit) => {
      void init
      if (path === '/api/teams/9') return Promise.resolve(ok({ id: 9, name: 'Team', description: null, joinPolicy: 'REQUEST' }))
      if (path === '/api/teams/9/members') return Promise.resolve(ok([{ userId: 4, username: 'member', displayName: 'Member', role: 'OWNER' }]))
      if (path.startsWith('/api/teams/9/projects')) return Promise.resolve(ok({ items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 }))
      if (path === '/api/teams/9/join-requests' || path === '/api/teams/9/invitations') return Promise.resolve(ok([]))
      if (path === '/api/teams/9/invitees/lookup?identifier=absent%40example.test') return Promise.resolve(new Response(JSON.stringify({ code: 'USER_NOT_FOUND', message: '未找到对应的已注册用户' }), { status: 404, headers: { 'Content-Type': 'application/json' } }))
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByRole('heading', { name: '邀请成员' })
    fireEvent.change(screen.getByRole('textbox', { name: '用户名或邮箱' }), { target: { value: 'absent@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: '查找用户' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('未找到该用户')
    expect(screen.queryByRole('button', { name: '确认发送邀请' })).toBeNull()
    expect(window.location.pathname).toBe('/teams/9')
    expect(fetcher.mock.calls.some(([path, init]) => path === '/api/teams/9/invitations' && init?.method === 'POST')).toBe(false)
  })

  it('shows member list but hides owner controls from members', async () => {
    window.history.replaceState(null, '', '/teams/9')
    setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
    const fetcher = vi.fn((path: string) => {
      if (path === '/api/teams/9') return Promise.resolve(ok({ id: 9, name: 'Team', description: null, joinPolicy: 'REQUEST' }))
      if (path === '/api/teams/9/members') return Promise.resolve(ok([{ userId: 4, username: 'member', displayName: 'Member', role: 'MEMBER' }]))
      if (path.startsWith('/api/teams/9/projects')) return Promise.resolve(ok({ items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 }))
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByRole('heading', { name: 'Team' })
    expect(screen.getByText('@member · 成员')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '邀请成员' })).toBeNull()
    expect(screen.queryByRole('button', { name: '转移所有权' })).toBeNull()
    await waitFor(() => expect(fetcher.mock.calls.every(([path]) => !String(path).includes('invitations'))).toBe(true))
  })

  it('clears a removed member view after the next denied action', async () => {
    window.history.replaceState(null, '', '/teams/9')
    setCredentials({ user, accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 })
    vi.stubGlobal('fetch', vi.fn((path: string, init?: RequestInit) => {
      if (path === '/api/teams/9') return Promise.resolve(ok({ id: 9, name: 'Team', description: null, joinPolicy: 'REQUEST' }))
      if (path === '/api/teams/9/members/me' && init?.method === 'DELETE') return Promise.resolve(new Response(JSON.stringify({ message: '团队不存在' }), { status: 404 }))
      if (path === '/api/teams/9/members') return Promise.resolve(ok([{ userId: 4, username: 'member', displayName: 'Member', role: 'MEMBER' }]))
      if (path.startsWith('/api/teams/9/projects')) return Promise.resolve(ok({ items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 }))
      if (path === '/api/teams?size=100') return Promise.resolve(ok({ content: [], number: 0, size: 100, totalElements: 0, totalPages: 0 }))
      throw new Error(`Unexpected request: ${path}`)
    }))
    render(<App />)
    await screen.findByRole('heading', { name: 'Team' })
    fireEvent.click(screen.getByRole('button', { name: '退出团队' }))
    await screen.findByRole('heading', { name: '我的团队' })
    expect(screen.queryByRole('heading', { name: 'Team' })).toBeNull()
  })
})
