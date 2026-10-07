import {
  Button,
  Card,
  Empty,
  Input,
  Layout,
  Menu,
  Modal,
  Select,
  Spin,
  Table,
  Tag,
  Tooltip,
} from 'antd'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom'
import {
  CodeOutlined,
  CompassOutlined,
  MailOutlined,
  TeamOutlined,
  LogoutOutlined,
  UpOutlined,
  DownOutlined,
  EditOutlined,
  CopyOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { AppTheme } from './ui/AppTheme'
import { useDialogs } from './ui/useDialogs'
import { getAuthUser, login, logout, register, subscribeAuth } from './api/auth'
import { ApiError } from './api/client'
import { useFeedback, useNotice } from './ui/useNotice'
import * as teams from './api/teams'
import type { TeamProjectDetails, TeamProjectSummary } from './types/collaboration'
import type { Invitation, Invitee, JoinRequest, Member, MyInvitation, Team } from './types/team'
const ProjectWorkspace = lazy(() => import('./editor/v2/ProjectWorkspace'))

/**
 * 优先展示 API 返回消息，没有消息时按业务码、状态及限流等待时间兜底。
 *
 * @param error 待展示的错误
 */
function message(error: unknown) {
  if (error instanceof ApiError) {
    if (error.responseMessage) return error.responseMessage
    if (error.code === 'USER_NOT_FOUND')
      return '未找到该用户，请先确认用户名或邮箱，并请对方注册账号。'
    if (error.code === 'COLLAB_CREATION_DISABLED') return '项目创建暂未开放。'
    if (
      error.code === 'COLLAB_INITIALIZATION_FAILED' ||
      error.code === 'COLLAB_INITIALIZER_UNAVAILABLE' ||
      error.code === 'STORAGE_UNAVAILABLE'
    )
      return '项目文件初始化未完成，请稍后重试。'
    if (error.status === 409) return '内容已变化，请重新加载后再试。'
    if (error.status === 429) return `操作过于频繁，请在 ${error.retryAfter ?? '稍后'} 秒后重试。`
    if (error.status === 403) return '没有执行此操作的权限。'
    if (error.status === 410) return '邀请已失效，请联系团队所有者重新邀请。'
  }
  return error instanceof Error ? error.message : '操作失败，请稍后重试。'
}

/**
 * 提供异步操作包装器及忙碌、错误和成功提示状态。
 */
function useTask() {
  const show = useNotice()
  const [busy, setBusy] = useState(false)
  const setError = useCallback(
    (error: string) => {
      if (error) show(error, 'error')
    },
    [show],
  )
  /**
   * 执行异步任务，统一维护忙碌状态、错误提示和可选成功消息。
   *
   * @param task 待执行的异步任务
   * @param success 成功后展示的可选消息
   */
  const run = async (task: () => Promise<void>, success?: string) => {
    setBusy(true)
    try {
      await task()
      if (success) show(success, 'success')
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  return { busy, run, setError }
}

/**
 * 按 mode 渲染登录或注册表单，完成后导航到团队列表或登录页。
 */
function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const navigate = useNavigate()
  const task = useTask()
  const [passwordVisible, setPasswordVisible] = useState(false)
  return (
    <main className="auth-shell">
      <div className="auth-intro">
        <span className="auth-logo">
          <CodeOutlined /> WEB EDITOR
        </span>
        <h1>
          一起编写，
          <br />
          即刻呈现。
        </h1>
        <p>
          从一个想法开始，与你的团队共同构建。
          <br />
          实时协作编辑，让每次修改都触手可见。
        </p>
        <div className="auth-feature">
          <TeamOutlined /> 团队协作 <span>·</span> 实时预览 <span>·</span> 自动保存
        </div>
      </div>
      <Card className="auth-card">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const name = String(form.get('login') ?? '').trim()
            const password = String(form.get('password') ?? '')
            void task.run(async () => {
              if (mode === 'register') {
                await register(name, String(form.get('email') ?? '').trim(), password)
                navigate('/login', { replace: true })
              } else {
                await login(name, password)
                navigate('/teams', { replace: true })
              }
            })
          }}
        >
          <span className="auth-eyebrow">你的创作空间</span>
          <h2>{mode === 'login' ? '登录' : '注册账号'}</h2>
          <p className="auth-description">
            {mode === 'login' ? '欢迎回来，继续你的团队项目。' : '创建账号，开始与团队共同创作。'}
          </p>
          <label>
            用户名{mode === 'login' ? '或邮箱' : ''}
            <Input name="login" required autoComplete="username" />
          </label>
          {mode === 'register' ? (
            <label>
              邮箱（可选）
              <Input name="email" type="email" autoComplete="email" />
            </label>
          ) : null}
          <div className="auth-password-field">
            <label htmlFor={`${mode}-password`}>密码</label>
            <div className="auth-password-input">
              <Input
                id={`${mode}-password`}
                name="password"
                type={mode === 'login' && passwordVisible ? 'text' : 'password'}
                required
                minLength={10}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
              {mode === 'login' ? (
                <Button
                  className="auth-password-toggle"
                  htmlType="button"
                  aria-label={passwordVisible ? '隐藏密码' : '显示密码'}
                  aria-controls={`${mode}-password`}
                  aria-pressed={passwordVisible}
                  title={passwordVisible ? '隐藏密码' : '显示密码'}
                  onClick={() => setPasswordVisible((value) => !value)}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                    {passwordVisible ? null : <path d="m3 3 18 18" />}
                  </svg>
                </Button>
              ) : null}
            </div>
          </div>
          <Button type="primary" htmlType="submit" loading={task.busy} disabled={task.busy} block>
            {mode === 'login' ? '登录' : '注册'}
          </Button>
          <Button
            block
            href={mode === 'login' ? '/register' : '/login'}
            onClick={(event) => {
              event.preventDefault()
              navigate(mode === 'login' ? '/register' : '/login')
            }}
          >
            {mode === 'login' ? '创建账号' : '前往登录'}
          </Button>
        </form>
      </Card>
    </main>
  )
}

/**
 * 渲染团队应用公共导航和当前账号，提供退出当前用户操作。
 */
function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const [topbarCollapsed, setTopbarCollapsed] = useState(false)
  const user = useSyncExternalStore(subscribeAuth, getAuthUser)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const task = useTask()
  const selected = pathname.startsWith('/teams') ? '/teams' : pathname
  return (
    <Layout className={`v2-shell${wide ? ' v2-shell-wide' : ''}`}>
      <Layout.Header className={`v2-topbar${topbarCollapsed ? ' v2-topbar-collapsed' : ''}`}>
        <div id="v2-topbar-content" className="v2-topbar-content" hidden={topbarCollapsed}>
          <Link className="v2-brand" to="/teams">
            <CodeOutlined /> <span>WEB EDITOR</span>
          </Link>
          <nav aria-label="主导航">
            <Menu
              mode="horizontal"
              selectedKeys={[selected]}
              items={[
                {
                  key: '/teams',
                  icon: <TeamOutlined />,
                  label: (
                    <Link to="/teams" aria-current={selected === '/teams' ? 'page' : undefined}>
                      我的团队
                    </Link>
                  ),
                },
                {
                  key: '/discover',
                  icon: <CompassOutlined />,
                  label: (
                    <Link
                      to="/discover"
                      aria-current={selected === '/discover' ? 'page' : undefined}
                    >
                      发现团队
                    </Link>
                  ),
                },
                {
                  key: '/invitations',
                  icon: <MailOutlined />,
                  label: (
                    <Link
                      to="/invitations"
                      aria-current={selected === '/invitations' ? 'page' : undefined}
                    >
                      我的邀请
                    </Link>
                  ),
                },
              ]}
            />
          </nav>
          <div className="v2-account">
            <span>{user?.displayName}</span>
            <Button
              danger
              icon={<LogoutOutlined />}
              htmlType="button"
              title="退出当前用户"
              aria-label="退出当前用户"
              loading={task.busy}
              disabled={task.busy}
              onClick={() =>
                void task.run(async () => {
                  await logout()
                  navigate('/login', { replace: true })
                })
              }
            />
          </div>
        </div>
        <Button
          className="v2-topbar-toggle"
          type="text"
          size="small"
          htmlType="button"
          icon={topbarCollapsed ? <DownOutlined /> : <UpOutlined />}
          title={topbarCollapsed ? '展开顶部栏' : '折叠顶部栏'}
          aria-label={topbarCollapsed ? '展开顶部栏' : '折叠顶部栏'}
          aria-expanded={!topbarCollapsed}
          aria-controls="v2-topbar-content"
          onClick={() => setTopbarCollapsed((value) => !value)}
        />
      </Layout.Header>
      <Layout.Content className="v2-content">{children}</Layout.Content>
    </Layout>
  )
}

/**
 * 加载当前用户团队列表，并提供团队创建及导航。
 */
function TeamListPage() {
  const navigate = useNavigate()
  const task = useTask()
  const [createOpen, setCreateOpen] = useState(false)
  const [items, setItems] = useState<Team[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void teams
      .listMyTeams(controller.signal)
      .then((page) => {
        setItems(page.content)
        setLoaded(true)
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setLoadError(message(error))
          setLoaded(true)
        }
      })
    return () => controller.abort()
  }, [])
  useFeedback({ error: loadError })
  return (
    <Shell>
      <section className="v2-section">
        <div className="v2-heading v2-team-heading">
          <div>
            <p>工作区</p>
            <h1>我的团队</h1>
          </div>
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            创建团队
          </Button>
        </div>

        <Table<Team>
          className="v2-team-table"
          rowKey="id"
          rowClassName="v2-team-row"
          onRow={(team) => ({
            tabIndex: 0,
            'aria-label': `查看团队 ${team.name}`,
            onClick: () => navigate(`/teams/${team.id}`),
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                navigate(`/teams/${team.id}`)
              }
            },
          })}
          dataSource={items}
          pagination={false}
          scroll={{ x: 600 }}
          loading={{ spinning: !loaded, description: '正在加载团队…' }}
          locale={{
            emptyText: (
              <Empty description="还没有加入团队。你可以创建一个团队，或在“发现团队”中申请加入。" />
            ),
          }}
          columns={[
            {
              title: '团队名称',
              dataIndex: 'name',
              width: 220,
              render: (name: string) => <strong>{name}</strong>,
            },
            {
              title: '团队描述',
              dataIndex: 'description',
              render: (description: string | null) => (
                <span className="v2-team-description">{description || '暂无描述'}</span>
              ),
            },
          ]}
        />
        <Modal
          title="创建团队"
          open={createOpen}
          onCancel={() => {
            if (!task.busy) setCreateOpen(false)
          }}
          footer={null}
          destroyOnHidden
          closable={!task.busy}
          keyboard={!task.busy}
          mask={{ closable: !task.busy }}
        >
          <form
            className="v2-form"
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              void task.run(async () => {
                const team = await teams.createTeam(
                  String(form.get('name')),
                  String(form.get('description')),
                )
                navigate(`/teams/${team.id}`)
              })
            }}
          >
            <label>
              名称
              <Input name="name" autoFocus required maxLength={100} />
            </label>
            <label>
              描述
              <Input.TextArea name="description" maxLength={500} rows={3} />
            </label>
            <div className="v2-actions v2-team-create-actions">
              <Button onClick={() => setCreateOpen(false)} disabled={task.busy}>
                取消
              </Button>
              <Button type="primary" htmlType="submit" loading={task.busy} disabled={task.busy}>
                创建团队
              </Button>
            </div>
          </form>
        </Modal>
      </section>
    </Shell>
  )
}

/**
 * 防抖搜索可申请团队，同步当前待处理申请并提供提交或撤回。
 */
function DiscoverPage() {
  const task = useTask()
  const setError = task.setError
  const [draftQuery, setDraftQuery] = useState('')
  const [query, setQuery] = useState('')
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [loadedPage, setLoadedPage] = useState<number | null>(null)
  const [pageSize, setPageSize] = useState(10)
  const [loadedPageSize, setLoadedPageSize] = useState<number | null>(null)
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<Team[]>([])
  const [pending, setPending] = useState<number[]>([])
  const loading = loadedQuery !== query || loadedPage !== page || loadedPageSize !== pageSize
  useEffect(() => {
    const nextQuery = draftQuery.trim()
    if (nextQuery === query) return
    const timer = window.setTimeout(() => {
      setQuery(nextQuery)
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [draftQuery, query])
  useEffect(() => {
    const controller = new AbortController()
    void teams
      .discoverTeams(query, page - 1, pageSize, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setItems(result.content)
          setTotal(result.totalElements)
          setLoadedQuery(query)
          setLoadedPage(page)
          setLoadedPageSize(pageSize)
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(message(error))
          setItems([])
          setLoadedQuery(query)
          setLoadedPage(page)
          setLoadedPageSize(pageSize)
        }
      })
    return () => controller.abort()
  }, [query, page, pageSize, setError])
  useEffect(() => {
    const controller = new AbortController()
    void teams
      .listMyJoinRequests(controller.signal)
      .then((requests) => setPending(requests.map((request) => request.teamId)))
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error))
      })
    return () => controller.abort()
  }, [setError])
  return (
    <Shell>
      <section className="v2-section">
        <div className="v2-heading v2-discover-heading">
          <div>
            <p>加入团队</p>
            <h1>发现团队</h1>
          </div>
          <Input
            className="v2-discover-search"
            aria-label="搜索允许申请的团队"
            placeholder="搜索允许申请的团队"
            value={draftQuery}
            maxLength={100}
            allowClear
            onChange={(event) => setDraftQuery(event.target.value)}
            onClear={() => {
              setDraftQuery('')
              setQuery('')
              setPage(1)
            }}
          />
        </div>
        <Table<Team>
          className="v2-discover-table"
          size="small"
          rowKey="id"
          dataSource={loading ? [] : items}
          pagination={{
            current: page,
            pageSize,
            total: loadedQuery === query ? total : 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (count) => `共 ${count} 个团队`,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPageSize === pageSize ? nextPage : 1)
              setPageSize(nextPageSize)
            },
          }}
          scroll={{ x: 680 }}
          loading={{ spinning: loading, description: '正在查找团队…' }}
          locale={{ emptyText: <Empty description="没有找到可申请的团队。" /> }}
          columns={[
            {
              title: '团队名称',
              dataIndex: 'name',
              width: 220,
              render: (name: string) => <strong>{name}</strong>,
            },
            {
              title: '团队描述',
              dataIndex: 'description',
              render: (description: string | null) => (
                <span className="v2-team-description">{description || '暂无描述'}</span>
              ),
            },
            {
              title: '申请状态',
              width: 120,
              align: 'center',
              render: (_: unknown, team: Team) =>
                pending.includes(team.id) ? (
                  <Tag color="processing">等待审批</Tag>
                ) : (
                  <Tag>可申请</Tag>
                ),
            },
            {
              title: '操作',
              width: 132,
              align: 'center',
              render: (_: unknown, team: Team) =>
                pending.includes(team.id) ? (
                  <Button
                    size="small"
                    htmlType="button"
                    disabled={task.busy}
                    onClick={() =>
                      void task.run(async () => {
                        await teams.withdrawJoin(team.id)
                        setPending((ids) => ids.filter((id) => id !== team.id))
                      }, '申请已撤回。')
                    }
                  >
                    撤回申请
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    size="small"
                    htmlType="button"
                    disabled={task.busy}
                    onClick={() =>
                      void task.run(async () => {
                        await teams.requestJoin(team.id)
                        setPending((ids) => [...ids, team.id])
                      }, '加入申请已提交，获批前无法查看团队项目。')
                    }
                  >
                    申请加入
                  </Button>
                ),
            },
          ]}
        />
      </section>
    </Shell>
  )
}

/**
 * 加载当前用户站内邀请，接受后进入团队，拒绝后移除列表项。
 */
function InvitationsPage() {
  const navigate = useNavigate()
  const task = useTask()
  const [items, setItems] = useState<MyInvitation[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void teams
      .listMyInvitations(controller.signal)
      .then((invitations) => {
        setItems(invitations)
        setLoaded(true)
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setLoadError(message(error))
          setLoaded(true)
        }
      })
    return () => controller.abort()
  }, [])
  useFeedback({ error: loadError })
  return (
    <Shell>
      <section className="v2-section">
        <div className="v2-heading">
          <div>
            <p>加入团队</p>
            <h1>我的邀请</h1>
          </div>
        </div>

        {!loaded ? (
          <Spin description="正在加载邀请…">
            <div className="v2-loading" />
          </Spin>
        ) : !items.length ? (
          <Empty description="暂无待处理邀请。" />
        ) : (
          <div className="v2-cards">
            {items.map((invitation) => (
              <Card className="v2-card" key={invitation.id}>
                <h2>{invitation.teamName}</h2>
                <p>邀请你加入团队 · 有效期至 {new Date(invitation.expiresAt).toLocaleString()}</p>
                <div className="v2-actions">
                  <Button
                    color="green"
                    variant="solid"
                    htmlType="button"
                    disabled={task.busy}
                    onClick={() =>
                      void task.run(async () => {
                        const team = await teams.acceptInvitation(invitation.id)
                        navigate(`/teams/${team.id}`)
                      })
                    }
                  >
                    接受
                  </Button>
                  <Button
                    danger
                    htmlType="button"
                    disabled={task.busy}
                    onClick={() =>
                      void task.run(async () => {
                        await teams.rejectInvitation(invitation.id)
                        setItems((current) => current.filter((item) => item.id !== invitation.id))
                      }, '已拒绝邀请。')
                    }
                  >
                    拒绝
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </Shell>
  )
}

/**
 * 清除旧邀请链接的 hash，展示改用站内邀请的说明。
 */
function LegacyInvitePage() {
  useState(() => {
    if (window.location.hash)
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search,
      )
  })
  return (
    <main className="auth-shell">
      <section className="auth-status">
        <h1>旧邀请链接已停用</h1>
        <p>请联系团队所有者重新发送站内邀请，然后登录并在“我的邀请”中处理。</p>
        <Link to="/login">前往登录</Link>
      </section>
    </main>
  )
}

/**
 * 加载团队、成员及项目，为所有者提供申请审批、邀请和成员管理。
 */
function TeamPage() {
  const dialogs = useDialogs()
  const showNotice = useNotice()
  const teamId = Number(useParams().teamId)
  const user = useSyncExternalStore(subscribeAuth, getAuthUser)
  const navigate = useNavigate()
  const task = useTask()
  const [team, setTeam] = useState<Team | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [projects, setProjects] = useState<TeamProjectSummary[]>([])
  const [initializingId, setInitializingId] = useState<number | null>(null)
  const [requests, setRequests] = useState<JoinRequest[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [inviteIdentifier, setInviteIdentifier] = useState('')
  const [invitees, setInvitees] = useState<Invitee[]>([])
  const [inviteSearchComplete, setInviteSearchComplete] = useState(false)
  const inviteSearchVersion = useRef(0)
  const [loadError, setLoadError] = useState('')
  const isOwner = members.some((member) => member.userId === user?.id && member.role === 'OWNER')
  /**
   * 并行加载团队基础数据，只有当前用户为所有者时才读取审批及邀请列表；取消时不写入结果。
   *
   * @param signal 用于取消请求的信号
   */
  const reload = useCallback(
    async (signal?: AbortSignal) => {
      const [nextTeam, nextMembers, nextProjects] = await Promise.all([
        teams.getTeam(teamId, signal),
        teams.listMembers(teamId, signal),
        teams.listTeamProjects(teamId, signal),
      ])
      if (signal?.aborted) return
      setTeam(nextTeam)
      setMembers(nextMembers)
      setProjects(nextProjects.items)
      if (nextMembers.some((member) => member.userId === user?.id && member.role === 'OWNER')) {
        const [nextRequests, nextInvitations] = await Promise.all([
          teams.listJoinRequests(teamId, signal),
          teams.listInvitations(teamId, signal),
        ])
        if (!signal?.aborted) {
          setRequests(nextRequests)
          setInvitations(nextInvitations)
        }
      } else {
        setRequests([])
        setInvitations([])
      }
    },
    [teamId, user?.id],
  )
  /**
   * 包装团队操作，权限丢失或资源不可访问时清空团队数据并返回团队列表。
   *
   * @param operation 待执行的异步操作
   * @param success 成功后展示的可选消息
   */
  const runTeam = (operation: () => Promise<void>, success?: string) =>
    task.run(async () => {
      try {
        await operation()
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.status === 403 || (error.status === 404 && error.code !== 'USER_NOT_FOUND'))
        ) {
          setTeam(null)
          setMembers([])
          setProjects([])
          setRequests([])
          setInvitations([])
          navigate('/teams', { replace: true })
        }
        throw error
      }
    }, success)
  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve()
      .then(() => reload(controller.signal))
      .catch((error) => {
        if (controller.signal.aborted) return
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          setTeam(null)
          setMembers([])
          setProjects([])
          setRequests([])
          setInvitations([])
        }
        setLoadError(message(error))
      })
    return () => controller.abort()
  }, [reload])
  useFeedback({ error: loadError })
  return (
    <Shell>
      <section className="v2-section">
        <div className="v2-heading">
          <div>
            <p>
              <Link to="/teams">我的团队</Link> / 团队
            </p>
            <h1>{team?.name ?? '正在加载团队…'}</h1>
            <p>{team?.description}</p>
          </div>
        </div>

        {team ? (
          <>
            <div className="v2-columns">
              <Card className="v2-panel">
                <h2>成员</h2>
                <ul className="v2-list">
                  {members.map((member) => (
                    <li key={member.userId}>
                      <span>
                        {member.displayName}{' '}
                        <small>
                          @{member.username} · {member.role === 'OWNER' ? '所有者' : '成员'}
                        </small>
                      </span>
                      {isOwner && member.role === 'MEMBER' ? (
                        <span className="v2-actions">
                          <Button
                            htmlType="button"
                            disabled={task.busy}
                            onClick={() =>
                              void runTeam(async () => {
                                await teams.transferOwner(teamId, member.userId)
                                await reload()
                              })
                            }
                          >
                            转移所有权
                          </Button>
                          <Button
                            danger
                            htmlType="button"
                            disabled={task.busy}
                            onClick={() =>
                              void runTeam(async () => {
                                await teams.removeMember(teamId, member.userId)
                                await reload()
                              })
                            }
                          >
                            移除
                          </Button>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {!isOwner ? (
                  <Button
                    danger
                    className="v2-danger-button"
                    htmlType="button"
                    disabled={task.busy}
                    onClick={async () => {
                      if (
                        await dialogs.confirm(
                          `确定退出团队“${team.name}”？退出后将无法访问该团队的项目。`,
                        )
                      )
                        void runTeam(async () => {
                          await teams.leaveTeam(teamId)
                          navigate('/teams')
                        })
                    }}
                  >
                    退出团队
                  </Button>
                ) : null}
              </Card>
              <Card className="v2-panel">
                <h2>项目</h2>
                <p>团队成员可以共同编辑项目文件。</p>
                <form
                  className="v2-form v2-inline-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const form = new FormData(event.currentTarget)
                    void runTeam(async () => {
                      try {
                        const project = await teams.createTeamProject(
                          teamId,
                          String(form.get('name')).trim(),
                        )
                        navigate(`/teams/${teamId}/projects/${project.id}`)
                      } catch (error) {
                        if (error instanceof ApiError && error.initializingProjectId)
                          setInitializingId(error.initializingProjectId)
                        throw error
                      }
                    })
                  }}
                >
                  <label>
                    项目名称
                    <Input name="name" required maxLength={100} />
                  </label>
                  <Button
                    type="primary"
                    className="v2-primary-button"
                    htmlType="submit"
                    disabled={task.busy}
                  >
                    创建项目
                  </Button>
                </form>
                {initializingId ? (
                  <Button
                    htmlType="button"
                    disabled={task.busy}
                    onClick={() =>
                      void runTeam(async () => {
                        const project = await teams.retryTeamProjectInitialization(
                          teamId,
                          initializingId,
                        )
                        navigate(`/teams/${teamId}/projects/${project.id}`)
                      })
                    }
                  >
                    重试项目初始化
                  </Button>
                ) : null}
                <ul className="v2-list">
                  {projects.map((project) => (
                    <li key={project.id}>
                      <Link
                        className="v2-project-button"
                        to={`/teams/${teamId}/projects/${project.id}`}
                      >
                        {project.name}
                      </Link>
                    </li>
                  ))}
                </ul>
                {!projects.length ? <p>暂无项目。</p> : null}
              </Card>
            </div>
            {isOwner ? (
              <div className="v2-columns">
                <Card className="v2-panel">
                  <h2>加入申请</h2>
                  <ul className="v2-list">
                    {requests.map((request) => (
                      <li key={request.id}>
                        <span>@{request.username}</span>
                        <span className="v2-actions">
                          <Button
                            htmlType="button"
                            disabled={task.busy}
                            onClick={() =>
                              void runTeam(async () => {
                                await teams.decideJoin(teamId, request.id, 'approve')
                                await reload()
                              })
                            }
                          >
                            批准
                          </Button>
                          <Button
                            danger
                            htmlType="button"
                            disabled={task.busy}
                            onClick={() =>
                              void runTeam(async () => {
                                await teams.decideJoin(teamId, request.id, 'reject')
                                await reload()
                              })
                            }
                          >
                            拒绝
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {!requests.length ? <p>暂无待审批申请。</p> : null}
                  <label>
                    加入策略
                    <Select
                      aria-label="加入策略"
                      value={team.joinPolicy}
                      disabled={task.busy}
                      onChange={(value: Team['joinPolicy']) =>
                        void runTeam(async () => {
                          const next = await teams.setJoinPolicy(teamId, value)
                          setTeam(next)
                        })
                      }
                      options={[
                        { value: 'REQUEST', label: '允许申请' },
                        { value: 'INVITE_ONLY', label: '仅邀请' },
                      ]}
                    />
                  </label>
                </Card>
                <Card className="v2-panel">
                  <h2>邀请成员</h2>
                  <form
                    className="v2-form v2-inline-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const query = inviteIdentifier.trim()
                      if (!query) return
                      const version = ++inviteSearchVersion.current
                      setInvitees([])
                      setInviteSearchComplete(false)
                      void runTeam(async () => {
                        const found = await teams.searchInvitees(teamId, query)
                        if (version === inviteSearchVersion.current) {
                          setInvitees(found)
                          setInviteSearchComplete(true)
                          if (!found.length) showNotice('没有找到可邀请的用户，请尝试其他关键词。')
                        }
                      })
                    }}
                  >
                    <label>
                      用户名或邮箱
                      <Input
                        value={inviteIdentifier}
                        placeholder="输入部分用户名或邮箱"
                        required
                        maxLength={254}
                        onChange={(event) => {
                          inviteSearchVersion.current++
                          setInviteIdentifier(event.target.value)
                          setInvitees([])
                          setInviteSearchComplete(false)
                        }}
                      />
                    </label>
                    <Button
                      type="primary"
                      className="v2-primary-button"
                      htmlType="submit"
                      disabled={task.busy}
                    >
                      查找用户
                    </Button>
                  </form>
                  {inviteSearchComplete && invitees.length ? (
                    <div className="v2-invite-results" aria-label="用户搜索结果">
                      {invitees.length ? (
                        <>
                          <p>
                            找到 {invitees.length} 位用户，请确认要邀请的账号。
                            {invitees.length === 20 ? '最多显示 20 位，请细化关键词。' : ''}
                          </p>
                          <ul className="v2-list">
                            {invitees.map((invitee) => (
                              <li className="v2-invite-result" key={invitee.userId}>
                                <span>
                                  已找到：{invitee.displayName}（@{invitee.username}）
                                </span>
                                <Button
                                  htmlType="button"
                                  disabled={task.busy}
                                  onClick={() => {
                                    const version = inviteSearchVersion.current
                                    void runTeam(async () => {
                                      await teams.issueInvitation(teamId, invitee.userId)
                                      await reload()
                                      if (version === inviteSearchVersion.current)
                                        setInvitees((found) =>
                                          found.filter((value) => value.userId !== invitee.userId),
                                        )
                                    }, '邀请已发送，受邀人可在“我的邀请”中处理。')
                                  }}
                                >
                                  确认发送邀请
                                </Button>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <p role="status">没有找到可邀请的用户，请尝试其他关键词。</p>
                      )}
                    </div>
                  ) : null}
                  <ul className="v2-list">
                    {invitations.map((invitation) => (
                      <li key={invitation.id}>
                        <span>
                          {invitation.username ? `@${invitation.username}` : invitation.email}{' '}
                          <small>{invitation.status}</small>
                        </span>
                        {invitation.status === 'PENDING' ? (
                          <Button
                            danger
                            htmlType="button"
                            disabled={task.busy}
                            onClick={() =>
                              void runTeam(async () => {
                                await teams.revokeInvitation(teamId, invitation.id)
                                await reload()
                              })
                            }
                          >
                            撤销
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            ) : null}
          </>
        ) : null}
        {dialogs.holder}
      </section>
    </Shell>
  )
}

/**
 * 加载团队项目元数据，提供重命名、当前文档复制和初始化重试。
 */
function ProjectPage() {
  const dialogs = useDialogs()
  const user = useSyncExternalStore(subscribeAuth, getAuthUser)
  const teamId = Number(useParams().teamId)
  const projectId = Number(useParams().projectId)
  const task = useTask()
  const navigate = useNavigate()
  const [project, setProject] = useState<TeamProjectDetails | null>(null)
  const [initializingId, setInitializingId] = useState<number | null>(null)
  const [loadError, setLoadError] = useState('')
  const [exportTarget, setExportTarget] = useState<HTMLSpanElement | null>(null)
  /**
   * 包装项目操作，遇到权限或资源错误时清除详情并返回团队列表。
   *
   * @param operation 待执行的异步操作
   * @param success 成功后展示的可选消息
   */
  const runProject = (operation: () => Promise<void>, success?: string) =>
    task.run(async () => {
      try {
        await operation()
      } catch (error) {
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          setProject(null)
          navigate('/teams', { replace: true })
        }
        throw error
      }
    }, success)
  useEffect(() => {
    const controller = new AbortController()
    void teams
      .getTeamProject(teamId, projectId, controller.signal)
      .then(setProject)
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(message(error))
      })
    return () => controller.abort()
  }, [teamId, projectId])
  useFeedback({ error: loadError })
  return (
    <Shell wide>
      <section className="v2-section v2-project-section">
        <div className="v2-heading">
          <p>
            <Link to={`/teams/${teamId}`}>团队项目</Link> / 项目
          </p>
        </div>
        <Card className="v2-panel">
          <div className="v2-project-bar">
            <h1>{project?.name ?? '正在加载项目…'}</h1>
            {project ? (
              <div className="v2-actions">
                <span ref={setExportTarget} />
                <Tooltip title="重命名">
                  <Button
                    htmlType="button"
                    type="text"
                    icon={<EditOutlined style={{ fontSize: 20 }} />}
                    aria-label="重命名"
                    disabled={task.busy}
                    onClick={async () => {
                      const name = await dialogs.prompt('新的项目名称', project.name)
                      if (name && name !== project.name)
                        void runProject(async () => {
                          const next = await teams.updateTeamProject(teamId, project, name)
                          setProject({ ...project, ...next })
                        }, '项目已重命名。')
                    }}
                  />
                </Tooltip>
                <Tooltip title="复制项目">
                  <Button
                    htmlType="button"
                    type="text"
                    icon={<CopyOutlined style={{ fontSize: 20 }} />}
                    aria-label="复制项目"
                    disabled={task.busy}
                    onClick={async () => {
                      const name = await dialogs.prompt('副本名称', `${project.name} 副本`)
                      if (name)
                        void runProject(async () => {
                          try {
                            const copy = await teams.copyTeamProject(teamId, project.id, name)
                            navigate(`/teams/${teamId}/projects/${copy.id}`)
                          } catch (error) {
                            if (error instanceof ApiError && error.initializingProjectId)
                              setInitializingId(error.initializingProjectId)
                            throw error
                          }
                        })
                    }}
                  />
                </Tooltip>
                <Tooltip title="删除">
                  <Button
                    danger
                    htmlType="button"
                    type="text"
                    icon={<DeleteOutlined style={{ fontSize: 20 }} />}
                    aria-label="删除"
                    disabled={task.busy}
                    onClick={async () => {
                      if (await dialogs.confirm(`确定删除项目“${project.name}”？删除后无法恢复。`))
                        void runProject(async () => {
                          await teams.deleteTeamProject(teamId, project)
                          setProject(null)
                          navigate(`/teams/${teamId}`, { replace: true })
                        })
                    }}
                  />
                </Tooltip>
                {initializingId ? (
                  <Tooltip title="重试项目初始化">
                    <Button
                      htmlType="button"
                      type="text"
                      icon={<ReloadOutlined style={{ fontSize: 20 }} />}
                      aria-label="重试项目初始化"
                      disabled={task.busy}
                      onClick={() =>
                        void runProject(async () => {
                          const copy = await teams.retryTeamProjectInitialization(
                            teamId,
                            initializingId,
                          )
                          navigate(`/teams/${teamId}/projects/${copy.id}`)
                        })
                      }
                    />
                  </Tooltip>
                ) : null}
              </div>
            ) : null}
          </div>
        </Card>
        {project && user ? (
          <Suspense
            fallback={
              <Spin description="正在加载编辑器…">
                <div className="v2-loading" />
              </Spin>
            }
          >
            <ProjectWorkspace
              key={`${user.id}:${project.id}:${project.collaboration.epoch}`}
              project={project}
              userId={user.id}
              teamId={teamId}
              exportTarget={exportTarget}
            />
          </Suspense>
        ) : null}
        {dialogs.holder}
      </section>
    </Shell>
  )
}

/**
 * 用团队 ID 作为组件 key，切换团队时重新建立页面状态。
 */
function TeamRoute() {
  const { teamId } = useParams()
  return <TeamPage key={teamId} />
}

/**
 * 用团队与项目 ID 作为组件 key，切换项目时重新建立页面状态。
 */
function ProjectRoute() {
  const { teamId, projectId } = useParams()
  return <ProjectPage key={`${teamId}:${projectId}`} />
}

/**
 * 按内存认证状态选择公开页面及团队路由，未登录访问受保护页面时跳转登录。
 */
function AppRoutes() {
  const user = useSyncExternalStore(subscribeAuth, getAuthUser)
  return (
    <Routes>
      <Route path="/invite" element={<LegacyInvitePage />} />
      <Route
        path="/login"
        element={user ? <Navigate to="/teams" replace /> : <AuthPage key="login" mode="login" />}
      />
      <Route
        path="/register"
        element={
          user ? <Navigate to="/teams" replace /> : <AuthPage key="register" mode="register" />
        }
      />
      <Route path="/teams" element={user ? <TeamListPage /> : <Navigate to="/login" replace />} />
      <Route
        path="/discover"
        element={user ? <DiscoverPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/invitations"
        element={user ? <InvitationsPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/teams/:teamId"
        element={user ? <TeamRoute /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/teams/:teamId/projects/:projectId"
        element={user ? <ProjectRoute /> : <Navigate to="/login" replace />}
      />
      <Route path="*" element={<Navigate to={user ? '/teams' : '/login'} replace />} />
    </Routes>
  )
}

/**
 * 创建浏览器路由容器并挂载团队应用路由。
 */
export function V2App() {
  return (
    <AppTheme>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppTheme>
  )
}
