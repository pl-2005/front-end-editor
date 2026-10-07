import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { getAuthUser, login, logout, register, subscribeAuth } from './api/auth'
import { ApiError } from './api/client'
import * as teams from './api/teams'
import type { TeamProjectDetails, TeamProjectSummary } from './types/collaboration'
import type { Invitation, Invitee, JoinRequest, Member, MyInvitation, Team } from './types/team'
const ProjectWorkspace = lazy(() => import('./editor/v2/ProjectWorkspace'))

/**
 * 将 API 业务码、状态及限流等待时间转换为适合页面展示的中文错误提示。
 *
 * @param error 待展示的错误
 */
function message(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'USER_NOT_FOUND') return '未找到该用户，请先确认用户名或邮箱，并请对方注册账号。'
    if (error.code === 'COLLAB_CREATION_DISABLED') return '项目创建暂未开放。'
    if (error.code === 'COLLAB_INITIALIZATION_FAILED' || error.code === 'COLLAB_INITIALIZER_UNAVAILABLE' || error.code === 'STORAGE_UNAVAILABLE') return '项目文件初始化未完成，请稍后重试。'
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
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  /**
   * 执行异步任务，统一维护忙碌状态、错误提示和可选成功消息。
   *
   * @param task 待执行的异步任务
   * @param success 成功后展示的可选消息
   */
  const run = async (task: () => Promise<void>, success?: string) => {
    setBusy(true); setError(''); setNotice('')
    try { await task(); if (success) setNotice(success) }
    catch (cause) { setError(message(cause)) }
    finally { setBusy(false) }
  }
  return { error, notice, busy, run, setError }
}

/**
 * 渲染错误告警及成功状态消息，提供对应无障碍角色。
 */
function Feedback({ error, notice }: { error?: string; notice?: string }) {
  return <>{error ? <p className="v2-error" role="alert">{error}</p> : null}{notice ? <p className="v2-notice" role="status">{notice}</p> : null}</>
}

/**
 * 按 mode 渲染登录或注册表单，完成后导航到团队列表或登录页。
 */
function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const navigate = useNavigate()
  const task = useTask()
  return <main className="auth-shell"><form onSubmit={(event) => {
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
  }}>
    <h1>Web Editor</h1><h2>{mode === 'login' ? '登录' : '注册账号'}</h2>
    <label>用户名{mode === 'login' ? '或邮箱' : ''}<input name="login" required autoComplete="username" /></label>
    {mode === 'register' ? <label>邮箱（可选）<input name="email" type="email" autoComplete="email" /></label> : null}
    <label>密码<input name="password" type="password" required minLength={10} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
    <Feedback error={task.error} />
    <button type="submit" disabled={task.busy}>{task.busy ? '请稍候…' : mode === 'login' ? '登录' : '注册'}</button>
    <Link to={mode === 'login' ? '/register' : '/login'}>{mode === 'login' ? '创建账号' : '前往登录'}</Link>
  </form></main>
}

/**
 * 渲染团队应用公共导航和当前账号，提供退出所有设备操作。
 */
function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const user = useSyncExternalStore(subscribeAuth, getAuthUser)
  const navigate = useNavigate()
  const task = useTask()
  return <main className={`v2-shell${wide ? ' v2-shell-wide' : ''}`}>
    <header className="v2-topbar"><Link className="v2-brand" to="/teams">W/ <span>WEB EDITOR</span></Link>
      <nav aria-label="主导航"><Link to="/teams">我的团队</Link><Link to="/discover">发现团队</Link><Link to="/invitations">我的邀请</Link></nav>
      <div className="v2-account"><span>{user?.displayName}</span><button type="button" disabled={task.busy} onClick={() => void task.run(async () => { await logout(); navigate('/login', { replace: true }) })}>退出所有设备</button></div>
    </header>
    <div className="v2-content"><Feedback error={task.error} />{children}</div>
  </main>
}

/**
 * 加载当前用户团队列表，并提供团队创建及导航。
 */
function TeamListPage() {
  const navigate = useNavigate()
  const task = useTask()
  const [items, setItems] = useState<Team[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void teams.listMyTeams(controller.signal).then(page => { setItems(page.content); setLoaded(true) })
      .catch(error => { if (!controller.signal.aborted) { setLoadError(message(error)); setLoaded(true) } })
    return () => controller.abort()
  }, [])
  return <Shell><section className="v2-section"><div className="v2-heading"><div><p>工作区</p><h1>我的团队</h1></div></div>
    <Feedback error={loadError || task.error} notice={task.notice} />
    {!loaded ? <p>正在加载团队…</p> : items.length ? <div className="v2-cards">{items.map(team => <Link className="v2-card" key={team.id} to={`/teams/${team.id}`}><h2>{team.name}</h2><p>{team.description || '暂无描述'}</p><span>查看团队 →</span></Link>)}</div> : <p>还没有加入团队。你可以创建一个团队，或在“发现团队”中申请加入。</p>}
    <form className="v2-panel v2-form" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget)
      void task.run(async () => { const team = await teams.createTeam(String(form.get('name')), String(form.get('description'))); navigate(`/teams/${team.id}`) })
    }}><h2>创建团队</h2><label>名称<input name="name" required maxLength={100} /></label><label>描述<textarea name="description" maxLength={500} /></label><button type="submit" disabled={task.busy}>创建团队</button></form>
  </section></Shell>
}

/**
 * 按搜索词加载可申请团队，同步当前待处理申请并提供提交或撤回。
 */
function DiscoverPage() {
  const task = useTask()
  const setError = task.setError
  const [draftQuery, setDraftQuery] = useState('')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<Team[]>([])
  const [pending, setPending] = useState<number[]>([])
  useEffect(() => {
    const controller = new AbortController()
    void teams.discoverTeams(query, controller.signal).then(page => setItems(page.content))
      .catch(error => { if (!controller.signal.aborted) setError(message(error)) })
    return () => controller.abort()
  }, [query, setError])
  useEffect(() => {
    const controller = new AbortController()
    void teams.listMyJoinRequests(controller.signal).then(requests => setPending(requests.map(request => request.teamId)))
      .catch(error => { if (!controller.signal.aborted) setError(message(error)) })
    return () => controller.abort()
  }, [setError])
  return <Shell><section className="v2-section"><div className="v2-heading"><div><p>加入团队</p><h1>发现团队</h1></div></div>
    <form className="v2-search" onSubmit={event => { event.preventDefault(); setQuery(draftQuery.trim()) }}><label>搜索允许申请的团队<input value={draftQuery} maxLength={100} onChange={event => setDraftQuery(event.target.value)} placeholder="团队名称" /></label><button type="submit">搜索</button></form>
    <Feedback error={task.error} notice={task.notice} />
    <div className="v2-cards">{items.map(team => <article className="v2-card" key={team.id}><h2>{team.name}</h2><p>{team.description || '暂无描述'}</p><div className="v2-actions">
      {pending.includes(team.id) ? <button type="button" disabled={task.busy} onClick={() => void task.run(async () => { await teams.withdrawJoin(team.id); setPending(ids => ids.filter(id => id !== team.id)) }, '申请已撤回。')}>撤回申请</button>
        : <button type="button" disabled={task.busy} onClick={() => void task.run(async () => { await teams.requestJoin(team.id); setPending(ids => [...ids, team.id]) }, '加入申请已提交，获批前无法查看团队项目。')}>申请加入</button>}
    </div></article>)}</div>
    {!items.length ? <p>没有找到可申请的团队。</p> : null}
  </section></Shell>
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
    void teams.listMyInvitations(controller.signal).then(invitations => { setItems(invitations); setLoaded(true) })
      .catch(error => { if (!controller.signal.aborted) { setLoadError(message(error)); setLoaded(true) } })
    return () => controller.abort()
  }, [])
  return <Shell><section className="v2-section"><div className="v2-heading"><div><p>加入团队</p><h1>我的邀请</h1></div></div>
    <Feedback error={loadError || task.error} notice={task.notice} />
    {!loaded ? <p>正在加载邀请…</p> : !items.length ? <p>暂无待处理邀请。</p> : <div className="v2-cards">{items.map(invitation =>
      <article className="v2-card" key={invitation.id}><h2>{invitation.teamName}</h2><p>邀请你加入团队 · 有效期至 {new Date(invitation.expiresAt).toLocaleString()}</p>
        <div className="v2-actions"><button type="button" disabled={task.busy} onClick={() => void task.run(async () => {
          const team = await teams.acceptInvitation(invitation.id)
          navigate(`/teams/${team.id}`)
        })}>接受</button><button type="button" disabled={task.busy} onClick={() => void task.run(async () => {
          await teams.rejectInvitation(invitation.id)
          setItems(current => current.filter(item => item.id !== invitation.id))
        }, '已拒绝邀请。')}>拒绝</button></div>
      </article>)}</div>}
  </section></Shell>
}

/**
 * 清除旧邀请链接的 hash，展示改用站内邀请的说明。
 */
function LegacyInvitePage() {
  useState(() => {
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  })
  return <main className="auth-shell"><section className="auth-status"><h1>旧邀请链接已停用</h1>
    <p>请联系团队所有者重新发送站内邀请，然后登录并在“我的邀请”中处理。</p><Link to="/login">前往登录</Link>
  </section></main>
}

/**
 * 加载团队、成员及项目，为所有者提供申请审批、邀请和成员管理。
 */
function TeamPage() {
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
  const [invitee, setInvitee] = useState<Invitee | null>(null)
  const inviteSearchVersion = useRef(0)
  const [loadError, setLoadError] = useState('')
  const isOwner = members.some(member => member.userId === user?.id && member.role === 'OWNER')
  /**
   * 并行加载团队基础数据，只有当前用户为所有者时才读取审批及邀请列表；取消时不写入结果。
   *
   * @param signal 用于取消请求的信号
   */
  const reload = useCallback(async (signal?: AbortSignal) => {
    const [nextTeam, nextMembers, nextProjects] = await Promise.all([
      teams.getTeam(teamId, signal), teams.listMembers(teamId, signal), teams.listTeamProjects(teamId, signal),
    ])
    if (signal?.aborted) return
    setTeam(nextTeam); setMembers(nextMembers); setProjects(nextProjects.items)
    if (nextMembers.some(member => member.userId === user?.id && member.role === 'OWNER')) {
      const [nextRequests, nextInvitations] = await Promise.all([teams.listJoinRequests(teamId, signal), teams.listInvitations(teamId, signal)])
      if (!signal?.aborted) { setRequests(nextRequests); setInvitations(nextInvitations) }
    } else { setRequests([]); setInvitations([]) }
  }, [teamId, user?.id])
  /**
   * 包装团队操作，权限丢失或资源不可访问时清空团队数据并返回团队列表。
   *
   * @param operation 待执行的异步操作
   * @param success 成功后展示的可选消息
   */
  const runTeam = (operation: () => Promise<void>, success?: string) => task.run(async () => {
    try { await operation() }
    catch (error) {
      if (error instanceof ApiError && (error.status === 403 || (error.status === 404 && error.code !== 'USER_NOT_FOUND'))) {
        setTeam(null); setMembers([]); setProjects([]); setRequests([]); setInvitations([])
        navigate('/teams', { replace: true })
      }
      throw error
    }
  }, success)
  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => reload(controller.signal))
      .catch(error => {
        if (controller.signal.aborted) return
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          setTeam(null); setMembers([]); setProjects([]); setRequests([]); setInvitations([])
        }
        setLoadError(message(error))
      })
    return () => controller.abort()
  }, [reload])
  return <Shell><section className="v2-section"><div className="v2-heading"><div><p><Link to="/teams">我的团队</Link> / 团队</p><h1>{team?.name ?? '正在加载团队…'}</h1><p>{team?.description}</p></div></div>
    <Feedback error={loadError || task.error} notice={task.notice} />
    {team ? <><div className="v2-columns"><section className="v2-panel"><h2>成员</h2><ul className="v2-list">{members.map(member => <li key={member.userId}><span>{member.displayName} <small>@{member.username} · {member.role === 'OWNER' ? '所有者' : '成员'}</small></span>
      {isOwner && member.role === 'MEMBER' ? <span className="v2-actions"><button type="button" disabled={task.busy} onClick={() => void runTeam(async () => { await teams.transferOwner(teamId, member.userId); await reload() })}>转移所有权</button><button type="button" disabled={task.busy} onClick={() => void runTeam(async () => { await teams.removeMember(teamId, member.userId); await reload() })}>移除</button></span> : null}</li>)}</ul>
      {!isOwner ? <button type="button" disabled={task.busy} onClick={() => void runTeam(async () => { await teams.leaveTeam(teamId); navigate('/teams') })}>退出团队</button> : null}</section>
      <section className="v2-panel"><h2>项目</h2><p>团队成员可以共同编辑项目文件。</p>
        <form className="v2-form" onSubmit={event => {
          event.preventDefault(); const form = new FormData(event.currentTarget)
          void runTeam(async () => {
            try { const project = await teams.createTeamProject(teamId, String(form.get('name')).trim()); navigate(`/teams/${teamId}/projects/${project.id}`) }
            catch (error) { if (error instanceof ApiError && error.initializingProjectId) setInitializingId(error.initializingProjectId); throw error }
          })
        }}><label>项目名称<input name="name" required maxLength={100} /></label><button type="submit" disabled={task.busy}>创建项目</button></form>
        {initializingId ? <button type="button" disabled={task.busy} onClick={() => void runTeam(async () => {
          const project = await teams.retryTeamProjectInitialization(teamId, initializingId); navigate(`/teams/${teamId}/projects/${project.id}`)
        })}>重试项目初始化</button> : null}
        <ul className="v2-list">{projects.map(project => <li key={project.id}><Link to={`/teams/${teamId}/projects/${project.id}`}>{project.name}</Link></li>)}</ul>
        {!projects.length ? <p>暂无项目。</p> : null}</section></div>
      {isOwner ? <div className="v2-columns"><section className="v2-panel"><h2>加入申请</h2><ul className="v2-list">{requests.map(request => <li key={request.id}><span>@{request.username}</span><span className="v2-actions"><button type="button" disabled={task.busy} onClick={() => void runTeam(async () => { await teams.decideJoin(teamId, request.id, 'approve'); await reload() })}>批准</button><button type="button" disabled={task.busy} onClick={() => void runTeam(async () => { await teams.decideJoin(teamId, request.id, 'reject'); await reload() })}>拒绝</button></span></li>)}</ul>{!requests.length ? <p>暂无待审批申请。</p> : null}
        <label>加入策略<select value={team.joinPolicy} disabled={task.busy} onChange={event => void runTeam(async () => { const next = await teams.setJoinPolicy(teamId, event.target.value as Team['joinPolicy']); setTeam(next) })}><option value="REQUEST">允许申请</option><option value="INVITE_ONLY">仅邀请</option></select></label></section>
        <section className="v2-panel"><h2>邀请成员</h2><form className="v2-form" onSubmit={event => { event.preventDefault(); const identifier = inviteIdentifier.trim(); const version = ++inviteSearchVersion.current; setInvitee(null); void runTeam(async () => { const found = await teams.lookupInvitee(teamId, identifier); if (version === inviteSearchVersion.current) setInvitee(found) }) }}><label>用户名或邮箱<input value={inviteIdentifier} required maxLength={254} onChange={event => { inviteSearchVersion.current++; setInviteIdentifier(event.target.value); setInvitee(null) }} /></label><button type="submit" disabled={task.busy}>查找用户</button></form>
          {invitee ? <div className="v2-actions"><span>已找到：{invitee.displayName}（@{invitee.username}）</span><button type="button" disabled={task.busy} onClick={() => void runTeam(async () => { await teams.issueInvitation(teamId, invitee.userId); await reload(); setInvitee(null); setInviteIdentifier('') }, '邀请已发送，受邀人可在“我的邀请”中处理。')}>确认发送邀请</button></div> : null}
          <ul className="v2-list">{invitations.map(invitation => <li key={invitation.id}><span>{invitation.username ? `@${invitation.username}` : invitation.email} <small>{invitation.status}</small></span>{invitation.status === 'PENDING' ? <button type="button" disabled={task.busy} onClick={() => void runTeam(async () => { await teams.revokeInvitation(teamId, invitation.id); await reload() })}>撤销</button> : null}</li>)}</ul></section></div> : null}
    </> : null}
  </section></Shell>
}

/**
 * 加载团队项目元数据，提供重命名、当前文档复制和初始化重试。
 */
function ProjectPage() {
  const user = useSyncExternalStore(subscribeAuth, getAuthUser)
  const teamId = Number(useParams().teamId)
  const projectId = Number(useParams().projectId)
  const task = useTask()
  const navigate = useNavigate()
  const [project, setProject] = useState<TeamProjectDetails | null>(null)
  const [initializingId, setInitializingId] = useState<number | null>(null)
  const [loadError, setLoadError] = useState('')
  /**
   * 包装项目操作，遇到权限或资源错误时清除详情并返回团队列表。
   *
   * @param operation 待执行的异步操作
   * @param success 成功后展示的可选消息
   */
  const runProject = (operation: () => Promise<void>, success?: string) => task.run(async () => {
    try { await operation() }
    catch (error) {
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        setProject(null)
        navigate('/teams', { replace: true })
      }
      throw error
    }
  }, success)
  useEffect(() => {
    const controller = new AbortController()
    void teams.getTeamProject(teamId, projectId, controller.signal).then(setProject)
      .catch(error => { if (!controller.signal.aborted) setLoadError(message(error)) })
    return () => controller.abort()
  }, [teamId, projectId])
  return <Shell wide><section className="v2-section v2-project-section"><div className="v2-heading"><div><p><Link to={`/teams/${teamId}`}>团队项目</Link> / 项目</p><h1>{project?.name ?? '正在加载项目…'}</h1></div></div><Feedback error={loadError || task.error} notice={task.notice} />
    {project ? <div className="v2-panel"><div className="v2-actions"><button type="button" disabled={task.busy} onClick={() => {
      const name = window.prompt('新的项目名称', project.name)?.trim()
      if (name && name !== project.name) void runProject(async () => { const next = await teams.updateTeamProject(teamId, project, name); setProject({ ...project, ...next }) }, '项目已重命名。')
    }}>重命名</button><button type="button" disabled={task.busy} onClick={() => {
      const name = window.prompt('副本名称', `${project.name} 副本`)?.trim()
      if (name) void runProject(async () => {
        try { const copy = await teams.copyTeamProject(teamId, project.id, name); navigate(`/teams/${teamId}/projects/${copy.id}`) }
        catch (error) { if (error instanceof ApiError && error.initializingProjectId) setInitializingId(error.initializingProjectId); throw error }
      })
    }}>复制项目</button><button type="button" disabled={task.busy} onClick={() => {
      if (window.confirm(`确定删除项目“${project.name}”？删除后无法恢复。`)) void runProject(async () => {
        await teams.deleteTeamProject(teamId, project); setProject(null); navigate(`/teams/${teamId}`, { replace: true })
      })
    }}>删除</button>
      {initializingId ? <button type="button" disabled={task.busy} onClick={() => void runProject(async () => {
        const copy = await teams.retryTeamProjectInitialization(teamId, initializingId); navigate(`/teams/${teamId}/projects/${copy.id}`)
      })}>重试项目初始化</button> : null}
    </div></div> : null}
    {project && user ? <Suspense fallback={<p>正在加载编辑器…</p>}><ProjectWorkspace key={`${user.id}:${project.id}:${project.collaboration.epoch}`} project={project} userId={user.id} teamId={teamId} /></Suspense> : null}
  </section></Shell>
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
  return <Routes>
    <Route path="/invite" element={<LegacyInvitePage />} />
    <Route path="/login" element={user ? <Navigate to="/teams" replace /> : <AuthPage key="login" mode="login" />} />
    <Route path="/register" element={user ? <Navigate to="/teams" replace /> : <AuthPage key="register" mode="register" />} />
    <Route path="/teams" element={user ? <TeamListPage /> : <Navigate to="/login" replace />} />
    <Route path="/discover" element={user ? <DiscoverPage /> : <Navigate to="/login" replace />} />
    <Route path="/invitations" element={user ? <InvitationsPage /> : <Navigate to="/login" replace />} />
    <Route path="/teams/:teamId" element={user ? <TeamRoute /> : <Navigate to="/login" replace />} />
    <Route path="/teams/:teamId/projects/:projectId" element={user ? <ProjectRoute /> : <Navigate to="/login" replace />} />
    <Route path="*" element={<Navigate to={user ? '/teams' : '/login'} replace />} />
  </Routes>
}

/**
 * 创建浏览器路由容器并挂载团队应用路由。
 */
export function V2App() {
  return <BrowserRouter><AppRoutes /></BrowserRouter>
}
