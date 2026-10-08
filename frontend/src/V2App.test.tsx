import { act, fireEvent, render as renderUI, screen, waitFor, within } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { useEffect, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { TeamProjectDetails } from './types/collaboration'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { clearAuth, setCredentials } from './api/auth'
import { exportTeamProject } from './collaboration/exportTeamProject'
vi.mock('./collaboration/exportTeamProject', () => ({ exportTeamProject: vi.fn() }))
const workspace = vi.hoisted(() => ({
  nextId: 0,
  mounts: [] as number[],
  unmounts: [] as number[],
  props: [] as {
    project: TeamProjectDetails
    userId: number
    teamId: number
    exportTarget: HTMLSpanElement | null
  }[],
}))
vi.mock('./editor/v2/ProjectWorkspace', () => ({
  default: function Workspace(props: (typeof workspace.props)[number]) {
    const [id] = useState(() => ++workspace.nextId)
    workspace.props.push(props)
    useEffect(() => {
      workspace.mounts.push(id)
      return () => {
        workspace.unmounts.push(id)
      }
    }, [id])
    return (
      <section aria-label="项目协作工作区" data-instance={id}>
        {props.exportTarget
          ? createPortal(
              <button aria-label="测试工作区导出" data-instance={id}>
                导出
              </button>,
              props.exportTarget,
            )
          : null}
      </section>
    )
  },
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
    workspace.mounts.length = 0
    workspace.unmounts.length = 0
    workspace.props.length = 0
    vi.useRealTimers()
    clearAuth()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
  })

  it('returns to parent routes on direct entry and disables the button at the top level', async () => {
    window.history.replaceState(null, '', '/teams/9/projects/17')
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
    const team = { id: 9, name: 'Team', description: null, joinPolicy: 'REQUEST' }
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) => {
        if (path === '/api/teams?size=100') return Promise.resolve(ok({ content: [team] }))
        if (path === '/api/teams/9') return Promise.resolve(ok(team))
        if (path === '/api/teams/9/members')
          return Promise.resolve(ok([{ userId: 4, username: 'member', role: 'MEMBER' }]))
        if (path === '/api/teams/9/projects?size=100')
          return Promise.resolve(ok({ items: [{ id: 17, name: 'Project' }], totalElements: 1 }))
        if (path === '/api/teams/9/projects/17')
          return Promise.resolve(ok({ id: 17, name: 'Project', collaboration: { generation: 1 } }))
        throw new Error(`Unexpected request: ${path}`)
      }),
    )
    render(<App />)
    await screen.findByRole('heading', { name: 'Project' })
    expect(screen.getByRole('button', { name: '返回上一级' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '返回上一级' }))
    await screen.findByRole('heading', { name: 'Team' })
    expect(window.location.pathname).toBe('/teams/9')
    fireEvent.click(screen.getByRole('button', { name: '返回上一级' }))
    await screen.findByRole('heading', { name: '我的团队' })
    expect(window.location.pathname).toBe('/teams')
    expect(screen.getByRole('button', { name: '返回上一级' }).hasAttribute('disabled')).toBe(true)
  })

  it.each(['/teams', '/teams/9'])('edits team name and description from %s', async (route) => {
    window.history.replaceState(null, '', route)
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
    let team = {
      id: 9,
      name: 'Original team',
      description: '已有描述' as string | null,
      joinPolicy: 'REQUEST',
      role: 'OWNER',
    }
    const fetcher = vi.fn((path: string, init?: RequestInit) => {
      if (path === '/api/teams?size=100') return Promise.resolve(ok({ content: [team] }))
      if (path === '/api/teams/9' && init?.method === 'PUT') {
        team = { ...team, ...JSON.parse(String(init.body)) }
        return Promise.resolve(ok(team))
      }
      if (path === '/api/teams/9') return Promise.resolve(ok(team))
      if (path === '/api/teams/9/members')
        return Promise.resolve(ok([{ userId: 4, role: 'OWNER' }]))
      if (path === '/api/teams/9/projects?size=100') return Promise.resolve(ok({ items: [] }))
      if (path === '/api/teams/9/join-requests' || path === '/api/teams/9/invitations')
        return Promise.resolve(ok([]))
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByText('Original team')
    fireEvent.click(screen.getByRole('button', { name: '编辑', hidden: true }))
    expect(window.location.pathname).toBe(route)
    expect((screen.getByLabelText('团队名称') as HTMLInputElement).value).toBe('Original team')
    expect((screen.getByLabelText('团队描述') as HTMLTextAreaElement).value).toBe('已有描述')
    fireEvent.click(screen.getByRole('button', { name: '取消', hidden: true }))
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '编辑', hidden: true }))
    fireEvent.change(screen.getByLabelText('团队名称'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存', hidden: true }))
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
    fireEvent.change(screen.getByLabelText('团队名称'), { target: { value: ' New team ' } })
    fireEvent.change(screen.getByLabelText('团队描述'), { target: { value: ' 新描述 ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存', hidden: true }))
    await screen.findByText('New team')
    expect(team.description).toBe('新描述')
    expect(team.joinPolicy).toBe('REQUEST')
    fireEvent.click(screen.getByRole('button', { name: '编辑', hidden: true }))
    fireEvent.change(screen.getByLabelText('团队描述'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存', hidden: true }))
    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull())
    expect(team.description).toBeNull()
    expect(window.location.pathname).toBe(route)
  })

  it.each(['/teams', '/teams/9'])('hides team editing for members on %s', async (route) => {
    window.history.replaceState(null, '', route)
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
    const team = { id: 9, name: 'Member team', role: 'MEMBER' }
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) => {
        if (path === '/api/teams?size=100') return Promise.resolve(ok({ content: [team] }))
        if (path === '/api/teams/9') return Promise.resolve(ok(team))
        if (path === '/api/teams/9/members')
          return Promise.resolve(ok([{ userId: 4, role: 'MEMBER' }]))
        if (path === '/api/teams/9/projects?size=100') return Promise.resolve(ok({ items: [] }))
        throw new Error(`Unexpected request: ${path}`)
      }),
    )
    render(<App />)
    await screen.findByText('Member team')
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull()
  })

  it('manages projects from the table without triggering row navigation', async () => {
    window.history.replaceState(null, '', '/teams/9')
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
    let project = {
      id: 17,
      name: 'Original',
      description: '描述',
      template: 'vanilla',
      stateVersion: 1,
    }
    let removed = false
    const fetcher = vi.fn((path: string, init?: RequestInit) => {
      if (path === '/api/teams/9') return Promise.resolve(ok({ id: 9, name: 'Team' }))
      if (path === '/api/teams/9/members')
        return Promise.resolve(ok([{ userId: 4, role: 'MEMBER' }]))
      if (path === '/api/teams/9/projects?size=100')
        return Promise.resolve(ok({ items: removed ? [] : [project] }))
      if (path === '/api/teams/9/projects/17' && init?.method === 'PUT') {
        expect(new Headers(init.headers).get('If-Match')).toBe('"project-17-1"')
        project = { ...project, ...JSON.parse(String(init.body)), stateVersion: 2 }
        return Promise.resolve(ok(project))
      }
      if (path === '/api/teams/9/projects/17/copy') {
        expect(JSON.parse(String(init?.body))).toEqual({ name: 'Renamed 副本' })
        return Promise.resolve(ok({ ...project, id: 18 }))
      }
      if (path === '/api/teams/9/projects/17' && init?.method === 'DELETE') {
        expect(new Headers(init.headers).get('If-Match')).toBe('"project-17-2"')
        removed = true
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    vi.mocked(exportTeamProject).mockResolvedValue(undefined)
    render(<App />)
    const row = await screen.findByRole('row', { name: '查看项目 Original' })
    expect(
      within(row)
        .getAllByRole('button', { hidden: true })
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['编辑', '复制项目', '导出项目', '删除'])
    fireEvent.click(within(row).getByRole('button', { name: '编辑', hidden: true }))
    expect(window.location.pathname).toBe('/teams/9')
    fireEvent.change(screen.getByLabelText('项目名称'), {
      target: { value: 'Renamed' },
    })
    fireEvent.change(screen.getByLabelText('项目描述'), {
      target: { value: '新描述' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存', hidden: true }))
    await screen.findByRole('row', { name: '查看项目 Renamed', hidden: true })
    expect(window.location.pathname).toBe('/teams/9')
    fireEvent.click(screen.getByRole('button', { name: '复制项目', hidden: true }))
    await screen.findByLabelText('副本名称', { selector: 'input' })
    fireEvent.click(screen.getByRole('button', { name: '确定', hidden: true }))
    await waitFor(() =>
      expect(fetcher.mock.calls.some(([path]) => path.endsWith('/copy'))).toBe(true),
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '导出项目', hidden: true }).hasAttribute('disabled'),
      ).toBe(false),
    )
    fireEvent.click(screen.getByRole('button', { name: '导出项目', hidden: true }))
    await waitFor(() => expect(exportTeamProject).toHaveBeenCalledWith(9, 17, 4))
    expect(window.location.pathname).toBe('/teams/9')
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '删除', hidden: true }).hasAttribute('disabled'),
      ).toBe(false),
    )
    fireEvent.click(screen.getByRole('button', { name: '删除', hidden: true }))
    fireEvent.click(await screen.findByRole('button', { name: '确定', hidden: true }))
    await waitFor(() =>
      expect(screen.queryByRole('row', { name: '查看项目 Renamed', hidden: true })).toBeNull(),
    )
    expect(window.location.pathname).toBe('/teams/9')
  }, 60_000)

  it('keeps all team operations locked until the project copy and its reload finish', async () => {
    window.history.replaceState(null, '', '/teams/9')
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
    let finishCopy!: (response: Response) => void
    let finishReload!: (response: Response) => void
    const copy = new Promise<Response>((resolve) => {
      finishCopy = resolve
    })
    const reload = new Promise<Response>((resolve) => {
      finishReload = resolve
    })
    let loads = 0
    const team = { id: 9, name: 'Team', joinPolicy: 'REQUEST' }
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) => {
        if (path === '/api/teams/9') return ++loads === 1 ? Promise.resolve(ok(team)) : reload
        if (path === '/api/teams/9/members')
          return Promise.resolve(
            ok([
              { userId: 4, role: 'OWNER', username: 'member' },
              { userId: 5, role: 'MEMBER', username: 'other' },
            ]),
          )
        if (path === '/api/teams/9/projects?size=100')
          return Promise.resolve(ok({ items: [{ id: 17, name: 'Original', stateVersion: 1 }] }))
        if (path === '/api/teams/9/join-requests' || path === '/api/teams/9/invitations')
          return Promise.resolve(ok([]))
        if (path === '/api/teams/9/projects/17/copy') return copy
        throw new Error(`Unexpected request: ${path}`)
      }),
    )
    render(<App />)
    fireEvent.click(await screen.findByLabelText('复制项目', { selector: 'button' }))
    await screen.findByLabelText('副本名称', { selector: 'input' })
    fireEvent.click(screen.getByText('确定', { selector: '.ant-modal button span' }))
    await waitFor(() =>
      expect(
        screen
          .getByText('移除', { selector: 'button span' })
          .closest('button')!
          .hasAttribute('disabled'),
      ).toBe(true),
    )
    expect(
      screen
        .getByText('创建项目', { selector: 'button span' })
        .closest('button')!
        .hasAttribute('disabled'),
    ).toBe(true)
    await act(async () => {
      finishCopy(ok({ id: 18, name: 'Copy' }))
    })
    await waitFor(() => expect(loads).toBe(2))
    expect(
      screen
        .getByText('移除', { selector: 'button span' })
        .closest('button')!
        .hasAttribute('disabled'),
    ).toBe(true)
    await act(async () => {
      finishReload(ok(team))
    })
    await waitFor(() =>
      expect(
        screen
          .getByText('移除', { selector: 'button span' })
          .closest('button')!
          .hasAttribute('disabled'),
      ).toBe(false),
    )
  }, 20_000)

  it.each(['/teams/9', '/teams/9/projects/17'])(
    'cleans up project permission failures through the page executor at %s and reports once',
    async (route) => {
      window.history.replaceState(null, '', route)
      setCredentials({ user, accessToken: 'access', expiresIn: 600 })
      vi.stubGlobal(
        'fetch',
        vi.fn((path: string) => {
          if (path.endsWith('/copy'))
            return Promise.resolve(
              new Response(JSON.stringify({ code: 'ACCESS_DENIED', message: '项目操作被拒绝' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
              }),
            )
          if (path === '/api/teams?size=100') return Promise.resolve(ok({ content: [] }))
          if (path === '/api/teams/9') return Promise.resolve(ok({ id: 9, name: 'Team' }))
          if (path === '/api/teams/9/members')
            return Promise.resolve(ok([{ userId: 4, role: 'MEMBER' }]))
          if (path === '/api/teams/9/projects?size=100')
            return Promise.resolve(ok({ items: [{ id: 17, name: 'Original', stateVersion: 1 }] }))
          if (path === '/api/teams/9/projects/17')
            return Promise.resolve(
              ok({ id: 17, name: 'Original', stateVersion: 1, collaboration: { epoch: 1 } }),
            )
          throw new Error(`Unexpected request: ${path}`)
        }),
      )
      render(<App />)
      fireEvent.click(await screen.findByLabelText('复制项目', { selector: 'button' }))
      await screen.findByLabelText('副本名称', { selector: 'input' })
      fireEvent.click(screen.getByText('确定', { selector: '.ant-modal button span' }))
      await screen.findByRole('heading', { name: '我的团队' })
      expect(window.location.pathname).toBe('/teams')
      expect(screen.queryByRole('row', { name: '查看项目 Original' })).toBeNull()
      expect(screen.queryByRole('button', { name: '测试工作区导出' })).toBeNull()
      expect(await screen.findAllByText('项目操作被拒绝')).toHaveLength(1)
    },
    20_000,
  )

  it.each(['click', 'keyboard'])('opens a project using a table row %s', async (method) => {
    window.history.replaceState(null, '', '/teams/9')
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) => {
        if (path === '/api/teams/9') return Promise.resolve(ok({ id: 9, name: 'Team' }))
        if (path === '/api/teams/9/members')
          return Promise.resolve(ok([{ userId: 4, role: 'MEMBER' }]))
        if (path === '/api/teams/9/projects?size=100')
          return Promise.resolve(ok({ items: [{ id: 17, name: 'Project' }] }))
        if (path === '/api/teams/9/projects/17')
          return Promise.resolve(ok({ id: 17, name: 'Project', collaboration: { epoch: 1 } }))
        throw new Error(`Unexpected request: ${path}`)
      }),
    )
    render(<App />)
    const row = await screen.findByRole('row', { name: '查看项目 Project' })
    if (method === 'click') fireEvent.click(row)
    else fireEvent.keyDown(row, { key: 'Enter' })
    await screen.findByRole('heading', { name: 'Project' })
    expect(window.location.pathname).toBe('/teams/9/projects/17')
  })

  it.each([null, '项目用途\n第二行'])(
    'creates a project with description %s',
    async (description) => {
      window.history.replaceState(null, '', '/teams/9')
      setCredentials({ user, accessToken: 'access', expiresIn: 600 })
      const project = {
        id: 17,
        name: 'New project',
        description,
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
            description,
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
      const createButton = screen.getByRole('button', { name: '创建项目' })
      expect(screen.queryByRole('textbox', { name: '项目名称' })).toBeNull()
      fireEvent.mouseEnter(createButton)
      expect(screen.queryByRole('textbox', { name: '项目名称' })).toBeNull()
      fireEvent.click(createButton)
      await screen.findByRole('dialog', { name: '创建项目' })
      const nameInput = screen.getByRole('textbox', { name: '项目名称' })
      fireEvent.change(nameInput, { target: { value: 'Draft' } })
      fireEvent.click(screen.getByRole('button', { name: '取消' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
      fireEvent.click(createButton)
      const reopenedInput = await screen.findByRole('textbox', { name: '项目名称' })
      expect((reopenedInput as HTMLInputElement).value).toBe('')
      fireEvent.change(reopenedInput, { target: { value: '   ' } })
      fireEvent.click(screen.getByRole('button', { name: '创建' }))
      expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
      fireEvent.change(reopenedInput, {
        target: { value: ' New project ' },
      })
      if (description) {
        const descriptionInput = screen.getByRole('textbox', { name: '项目描述' })
        expect(descriptionInput.getAttribute('maxlength')).toBe('500')
        fireEvent.change(descriptionInput, { target: { value: ` ${description} ` } })
      }
      fireEvent.click(screen.getByRole('button', { name: '创建' }))
      await screen.findByRole('heading', { name: 'New project' })
      expect(
        screen.getByText(description || '暂无描述', { normalizer: (value) => value }),
      ).toBeTruthy()
      expect(screen.getByRole('button', { name: '删除' }).hasAttribute('disabled')).toBe(false)
      expect(
        fetcher.mock.calls.every(
          ([path]) => !path.includes('snapshot') && !path.includes('revision'),
        ),
      ).toBe(true)
    },
  )

  it('retries the reserved project after initialization fails', async () => {
    window.history.replaceState(null, '', '/teams/9')
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
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
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))
    fireEvent.change(screen.getByRole('textbox', { name: '项目名称' }), {
      target: { value: 'Retry project' },
    })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    fireEvent.click(await screen.findByRole('button', { name: '重试项目初始化' }))
    await screen.findByRole('heading', { name: 'Retry project' })
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/teams/9/projects')).toHaveLength(1)
  })

  it('saves name and description together through the edit icon after validating the name', async () => {
    window.history.replaceState(null, '', '/teams/9/projects/17')
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
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
        return Promise.resolve(
          ok({
            id: project.id,
            template: project.template,
            name: 'Renamed',
            description: '更新的描述',
            stateVersion: 2,
          }),
        )
      }
      if (path === '/api/teams/9/projects/17') return Promise.resolve(ok(project))
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByRole('heading', { name: 'Original' })
    await screen.findByRole('button', { name: '测试工作区导出' })
    const mounts = [...workspace.mounts]
    const unmounts = [...workspace.unmounts]
    const exportButton = screen.getByRole('button', { name: '测试工作区导出' })
    expect(screen.queryByRole('button', { name: '重命名' })).toBeNull()
    expect(screen.queryByRole('button', { name: '编辑描述' })).toBeNull()
    expect(screen.getAllByRole('button', { name: '编辑' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(await screen.findByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(await screen.findByRole('textbox', { name: '项目名称' }), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
    fireEvent.change(screen.getByRole('textbox', { name: '项目名称' }), {
      target: { value: ' Renamed ' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '项目描述' }), {
      target: { value: ' 更新的描述 ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByRole('heading', { name: 'Renamed' })
    const update = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')![1]!
    expect(JSON.parse(String(update.body))).toEqual({
      name: 'Renamed',
      description: '更新的描述',
      template: 'vanilla',
    })
    expect(screen.getByText('更新的描述')).toBeTruthy()
    expect(new Headers(update.headers).get('If-Match')).toBe('"project-17-1"')
    expect(workspace.props.at(-1)?.project).toMatchObject({
      name: 'Renamed',
      stateVersion: 2,
      collaboration: project.collaboration,
    })
    expect(workspace.mounts).toEqual(mounts)
    expect(workspace.unmounts).toEqual(unmounts)
    expect(screen.getByRole('button', { name: '测试工作区导出' })).toBe(exportButton)
    expect(exportButton.isConnected).toBe(true)
  })

  it('edits and clears descriptions while preserving project metadata and using the latest version', async () => {
    window.history.replaceState(null, '', '/teams/9/projects/17')
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
    let project = {
      id: 17,
      name: 'Original',
      description: '已有描述' as string | null,
      template: 'vanilla',
      stateVersion: 1,
      collaboration: { epoch: 1, generation: 1 },
    }
    const fetcher = vi.fn((path: string, init?: RequestInit) => {
      if (path === '/api/teams/9/projects/17' && init?.method === 'PUT') {
        const metadata = JSON.parse(String(init.body))
        expect(metadata.name).toBe('Original')
        expect(metadata.template).toBe('vanilla')
        expect(new Headers(init.headers).get('If-Match')).toBe(
          `"project-17-${project.stateVersion}"`,
        )
        project = { ...project, ...metadata, stateVersion: project.stateVersion + 1 }
        const { collaboration: _collaboration, ...summary } = project
        void _collaboration
        return Promise.resolve(ok(summary))
      }
      if (path === '/api/teams/9/projects/17') return Promise.resolve(ok(project))
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByRole('heading', { name: 'Original' })
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const input = await screen.findByRole('textbox', { name: '项目描述' })
    expect((input as HTMLTextAreaElement).value).toBe('已有描述')
    expect(input.getAttribute('maxlength')).toBe('500')
    fireEvent.change(input, { target: { value: '取消的修改' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(await screen.findByRole('textbox', { name: '项目描述' }), {
      target: { value: ' 新描述\n第二行 ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(project.description).toBe('新描述\n第二行')
    expect(screen.getByText('新描述 第二行')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(await screen.findByRole('textbox', { name: '项目描述' }), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(project.description).toBeNull()
    expect(screen.getByText('暂无描述')).toBeTruthy()
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(2)
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
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    expect(window.location.hash).toBe('')
    expect(screen.getByRole('heading', { name: '旧邀请链接已停用' })).toBeTruthy()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('shows an incoming invitation and accepts it by ID', async () => {
    window.history.replaceState(null, '', '/invitations')
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
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
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
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
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
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

  it('debounces invitation searches, ignores stale replies and clears the results', async () => {
    window.history.replaceState(null, '', '/teams/9')
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
    let resolveOldSearch!: (response: Response) => void
    const oldSearch = new Promise<Response>((resolve) => {
      resolveOldSearch = resolve
    })
    const fetcher = vi.fn((path: string) => {
      if (path === '/api/teams/9')
        return Promise.resolve(ok({ id: 9, name: 'Team', joinPolicy: 'REQUEST' }))
      if (path === '/api/teams/9/members')
        return Promise.resolve(ok([{ userId: 4, username: 'member', role: 'OWNER' }]))
      if (path === '/api/teams/9/projects?size=100')
        return Promise.resolve(ok({ items: [], totalElements: 0 }))
      if (path === '/api/teams/9/join-requests') return Promise.resolve(ok([]))
      if (path === '/api/teams/9/invitations')
        return Promise.resolve(ok([{ id: 12, username: 'bob', status: 'PENDING' }]))
      if (path === '/api/teams/9/invitees/search?query=al') return oldSearch
      if (path === '/api/teams/9/invitees/search?query=ali')
        return Promise.resolve(ok([{ userId: 8, username: 'alice', displayName: 'Alice' }]))
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const { container } = render(<App />)
    await screen.findByRole('heading', { name: '邀请成员' })
    const records = container.querySelector('details')!
    expect(records.hasAttribute('open')).toBe(false)
    fireEvent.click(screen.getByText('邀请记录（1）'))
    expect(records.hasAttribute('open')).toBe(true)
    expect(screen.getByRole('button', { name: '撤销' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '查找用户' })).toBeNull()
    const input = screen.getByPlaceholderText('请输入用户名或邮箱')
    const searches = () => fetcher.mock.calls.filter(([path]) => path.includes('/invitees/search'))
    vi.useFakeTimers()
    fireEvent.change(input, { target: { value: 'a' } })
    await act(() => vi.advanceTimersByTimeAsync(200))
    fireEvent.change(input, { target: { value: 'al' } })
    await act(() => vi.advanceTimersByTimeAsync(299))
    expect(searches()).toHaveLength(0)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(searches()).toHaveLength(1)
    fireEvent.change(input, { target: { value: 'ali' } })
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(screen.getByText('已找到：Alice（@alice）')).toBeTruthy()
    await act(async () => {
      resolveOldSearch(ok([{ userId: 10, username: 'alina', displayName: 'Alina' }]))
      await oldSearch
    })
    expect(screen.queryByText('已找到：Alina（@alina）')).toBeNull()
    fireEvent.click(container.querySelector('.ant-input-clear-icon')!)
    expect((input as HTMLInputElement).value).toBe('')
    expect(screen.queryByText('已找到：Alice（@alice）')).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(searches()).toHaveLength(2)
    vi.useRealTimers()
  })

  it('shows no-user feedback without sending an invitation', async () => {
    window.history.replaceState(null, '', '/teams/9')
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
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
      setCredentials({ user, accessToken: 'access', expiresIn: 600 })
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
      fireEvent.click(await screen.findByRole('button', { name: '确认发送邀请' }))
      expect((await screen.findByRole('alert')).textContent).toContain(reason)
      expect(screen.queryByText('内容已变化，请重新加载后再试。')).toBeNull()
      expect(screen.queryByText('邀请已发送，受邀人可在“我的邀请”中处理。')).toBeNull()
    },
  )

  it('paginates discovery on the server and resets searches without showing stale responses', async () => {
    window.history.replaceState(null, '', '/discover')
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
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
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
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
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
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
      setCredentials({ user, accessToken: 'access', expiresIn: 600 })
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
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
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
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
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
