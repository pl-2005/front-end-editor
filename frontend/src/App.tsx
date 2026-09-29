import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getAuthUser, login, logout, register, subscribeAuth } from './api/auth'
import { createProject, deleteProject, getProject, listProjects, saveSnapshot, updateProject } from './api/projects'
import { DEFAULT_FILES } from './editor/defaultFiles'
import { EditorWorkspace } from './editor/EditorWorkspace'
import { getDraft } from './persistence/drafts'
import type { ProjectDetails, ProjectFiles, ProjectSummary } from './types/project'

interface OpenProject { details: ProjectDetails; files: ProjectFiles; providerKey: string; recoveredDraft: boolean; recoveryMessage?: string }

async function loadOpenProject(id: number): Promise<OpenProject> {
  const details = await getProject(id)
  const serverFiles = Object.keys(details.files).length ? details.files : DEFAULT_FILES
  const draft = await getDraft(id).catch(() => undefined)
  const canRecover = draft?.baseVersion === details.version
  return {
    details,
    files: canRecover && draft ? draft.files : serverFiles,
    providerKey: `${details.id}-${details.version}`,
    recoveredDraft: Boolean(canRecover),
    recoveryMessage: canRecover ? '已恢复本地草稿' : draft ? '存在基于旧版本的本地草稿' : undefined,
  }
}

export function WorkspaceApp() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [opened, setOpened] = useState<OpenProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const openRequestRef = useRef(0)

  const refreshProjects = useCallback(async () => {
    const page = await listProjects()
    setProjects(page.items)
    return page.items
  }, [])

  const openProject = useCallback(async (id: number) => {
    const requestId = ++openRequestRef.current
    setLoading(true)
    setError(undefined)
    try {
      const result = await loadOpenProject(id)
      if (requestId === openRequestRef.current) setOpened(result)
    } catch (cause) {
      if (requestId === openRequestRef.current) setError(cause instanceof Error ? cause.message : '项目加载失败')
    } finally {
      if (requestId === openRequestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let ignore = false
    void (async () => {
      try {
        const page = await listProjects()
        const first = page.items[0] ? await loadOpenProject(page.items[0].id) : null
        if (!ignore) { setProjects(page.items); setOpened(first); setLoading(false) }
      } catch (cause) {
        if (!ignore) { setError(cause instanceof Error ? cause.message : '无法连接后端服务'); setLoading(false) }
      }
    })()
    return () => { ignore = true }
  }, [])

  const handleCreate = async () => {
    const name = window.prompt('项目名称', '未命名项目')?.trim()
    if (!name) return
    try { const project = await createProject(name); await refreshProjects(); await openProject(project.id) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '创建失败') }
  }

  const handleRename = async (project: ProjectSummary) => {
    const name = window.prompt('新的项目名称', project.name)?.trim()
    if (!name || name === project.name) return
    try {
      const updated = await updateProject(project, name)
      setProjects((current) => current.map((item) => item.id === updated.id ? updated : item))
      setOpened((current) => current?.details.id === updated.id ? { ...current, details: { ...current.details, name: updated.name } } : current)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '重命名失败') }
  }

  const handleDelete = async (project: ProjectSummary) => {
    if (!window.confirm(`确定删除项目“${project.name}”？`)) return
    try {
      await deleteProject(project)
      const items = await refreshProjects()
      if (opened?.details.id === project.id) { setOpened(null); if (items[0]) await openProject(items[0].id) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败') }
  }

  return <main className="app-shell">
    <aside className="project-sidebar">
      <div className="brand"><span>W/</span> WEB EDITOR</div>
      <div className="projects-heading"><span>项目</span><button type="button" onClick={() => void handleCreate()}>+</button></div>
      <nav aria-label="项目列表">
        {projects.map((project) => <div className={`project-row ${opened?.details.id === project.id ? 'active' : ''}`} key={project.id}>
          <button className="project-name" type="button" onClick={() => void openProject(project.id)}><strong>{project.name}</strong><small>v{project.version}</small></button>
          <div className="project-actions">
            <button type="button" title="重命名" onClick={() => void handleRename(project)}>✎</button>
            <button type="button" title="删除" onClick={() => void handleDelete(project)}>×</button>
          </div>
        </div>)}
      </nav>
      <button className="new-project" type="button" onClick={() => void handleCreate()}>＋ 新建项目</button>
    </aside>
    <section className="main-stage">
      <header className="app-header"><div><span className="breadcrumb">工作区 / </span><strong>{opened?.details.name ?? '选择项目'}</strong></div>{opened ? <span className="version-pill">版本 {opened.details.version}</span> : null}</header>
      {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(undefined)}>×</button></div> : null}
      {loading ? <div className="empty-state">正在加载工作区…</div> : null}
      {!loading && !opened ? <div className="empty-state"><span>W/</span><h1>创建第一个项目</h1><p>在浏览器里编写 HTML、CSS 和 JavaScript，并即时预览结果。</p><button type="button" onClick={() => void handleCreate()}>新建项目</button></div> : null}
      {!loading && opened ? <EditorWorkspace
        project={opened.details} files={opened.files} providerKey={opened.providerKey} recoveredDraft={opened.recoveredDraft} recoveryMessage={opened.recoveryMessage}
        onVersionChange={(projectId, version, stateVersion) => {
          setOpened((current) => current?.details.id === projectId
            ? { ...current, recoveredDraft: false, recoveryMessage: undefined, details: { ...current.details, version, stateVersion } }
            : current)
          setProjects((current) => current.map((item) => item.id === projectId ? { ...item, version, stateVersion } : item))
        }}
        onReload={() => void openProject(opened.details.id)}
        onSaveCopy={async (name, entry, files) => {
          let copy: ProjectSummary | undefined
          try {
            copy = await createProject(name, entry)
            await saveSnapshot(copy.id, copy.version, entry, files)
            await refreshProjects()
            await openProject(copy.id)
          } catch (cause) {
            if (copy) await deleteProject(copy).catch(() => undefined)
            setError(cause instanceof Error ? cause.message : '另存副本失败')
          }
        }}
      /> : null}
    </section>
  </main>
}

export default function App() {
  const user = useSyncExternalStore(subscribeAuth, getAuthUser)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!user) return <main className="auth-shell"><form onSubmit={(event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true); setError('')
    const name = String(form.get('login') ?? '')
    const password = String(form.get('password') ?? '')
    const task = mode === 'register'
      ? register(name, String(form.get('email') ?? ''), password).then(() => login(name, password))
      : login(name, password)
    void task.catch((cause) => setError(cause instanceof Error ? cause.message : '认证失败')).finally(() => setBusy(false))
  }}>
    <h1>Web Editor</h1>
    <h2>{mode === 'login' ? '登录' : '注册账号'}</h2>
    <label>用户名或邮箱<input name="login" required autoComplete="username" /></label>
    {mode === 'register' ? <label>邮箱（可选）<input name="email" type="email" autoComplete="email" /></label> : null}
    <label>密码<input name="password" type="password" required minLength={10} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
    {error ? <p role="alert">{error}</p> : null}
    <button type="submit" disabled={busy}>{busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}</button>
    <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
      {mode === 'login' ? '创建账号' : '返回登录'}
    </button>
  </form></main>
  return <main className="auth-shell">
    <section className="auth-status" aria-labelledby="auth-status-title">
      <div className="brand"><span>W/</span> WEB EDITOR</div>
      <p className="auth-status-label">已登录 · {user.displayName}</p>
      <h1 id="auth-status-title">账号已就绪</h1>
      <p>团队与项目功能仍在开发中，当前暂不能创建或打开项目。</p>
      <button type="button" onClick={() => void logout()}>退出所有设备</button>
    </section>
  </main>
}
