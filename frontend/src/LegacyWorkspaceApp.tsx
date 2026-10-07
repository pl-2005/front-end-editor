import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  saveSnapshot,
  updateProject,
} from './api/projects'
import { DEFAULT_FILES } from './editor/defaultFiles'
import { EditorWorkspace } from './editor/EditorWorkspace'
import { getDraft } from './persistence/drafts'
import type { ProjectDetails, ProjectFiles, ProjectSummary } from './types/project'

interface OpenProject {
  details: ProjectDetails
  files: ProjectFiles
  providerKey: string
  recoveredDraft: boolean
  recoveryMessage?: string
}

/**
 * 读取旧项目及本地草稿，仅恢复基于相同快照版本的草稿；无服务器文件时使用默认模板。
 *
 * @param id 项目 ID
 */
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

/**
 * 渲染旧快照工作区，管理项目选择、元数据操作、草稿恢复和编辑器会话。
 */
export function WorkspaceApp() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [opened, setOpened] = useState<OpenProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const openRequestRef = useRef(0)

  /**
   * 刷新项目侧栏并返回最新摘要列表。
   */
  const refreshProjects = useCallback(async () => {
    const page = await listProjects()
    setProjects(page.items)
    return page.items
  }, [])

  /**
   * 加载选定项目，以递增请求编号忽略晚到的旧加载结果。
   *
   * @param id 项目 ID
   */
  const openProject = useCallback(async (id: number) => {
    const requestId = ++openRequestRef.current
    setLoading(true)
    setError(undefined)
    try {
      const result = await loadOpenProject(id)
      if (requestId === openRequestRef.current) setOpened(result)
    } catch (cause) {
      if (requestId === openRequestRef.current)
        setError(cause instanceof Error ? cause.message : '项目加载失败')
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
        if (!ignore) {
          setProjects(page.items)
          setOpened(first)
          setLoading(false)
        }
      } catch (cause) {
        if (!ignore) {
          setError(cause instanceof Error ? cause.message : '无法连接后端服务')
          setLoading(false)
        }
      }
    })()
    return () => {
      ignore = true
    }
  }, [])

  /**
   * 询问项目名称，创建成功后刷新列表并打开新项目。
   */
  const handleCreate = async () => {
    const name = window.prompt('项目名称', '未命名项目')?.trim()
    if (!name) return
    try {
      const project = await createProject(name)
      await refreshProjects()
      await openProject(project.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建失败')
    }
  }

  /**
   * 提交新名称并同步列表及已打开项目标题；失败显示错误。
   *
   * @param project 项目实体或摘要
   */
  const handleRename = async (project: ProjectSummary) => {
    const name = window.prompt('新的项目名称', project.name)?.trim()
    if (!name || name === project.name) return
    try {
      const updated = await updateProject(project, name)
      setProjects((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      setOpened((current) =>
        current?.details.id === updated.id
          ? { ...current, details: { ...current.details, name: updated.name } }
          : current,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重命名失败')
    }
  }

  /**
   * 确认删除后刷新列表，当前项目被删除时打开剩余首个项目。
   *
   * @param project 项目实体或摘要
   */
  const handleDelete = async (project: ProjectSummary) => {
    if (!window.confirm(`确定删除项目“${project.name}”？`)) return
    try {
      await deleteProject(project)
      const items = await refreshProjects()
      if (opened?.details.id === project.id) {
        setOpened(null)
        if (items[0]) await openProject(items[0].id)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败')
    }
  }

  return (
    <main className="app-shell">
      <aside className="project-sidebar">
        <div className="brand">
          <span>W/</span> WEB EDITOR
        </div>
        <div className="projects-heading">
          <span>项目</span>
          <button type="button" onClick={() => void handleCreate()}>
            +
          </button>
        </div>
        <nav aria-label="项目列表">
          {projects.map((project) => (
            <div
              className={`project-row ${opened?.details.id === project.id ? 'active' : ''}`}
              key={project.id}
            >
              <button
                className="project-name"
                type="button"
                onClick={() => void openProject(project.id)}
              >
                <strong>{project.name}</strong>
                <small>v{project.version}</small>
              </button>
              <div className="project-actions">
                <button type="button" title="重命名" onClick={() => void handleRename(project)}>
                  ✎
                </button>
                <button type="button" title="删除" onClick={() => void handleDelete(project)}>
                  ×
                </button>
              </div>
            </div>
          ))}
        </nav>
        <button className="new-project" type="button" onClick={() => void handleCreate()}>
          ＋ 新建项目
        </button>
      </aside>
      <section className="main-stage">
        <header className="app-header">
          <div>
            <span className="breadcrumb">工作区 / </span>
            <strong>{opened?.details.name ?? '选择项目'}</strong>
          </div>
          {opened ? <span className="version-pill">版本 {opened.details.version}</span> : null}
        </header>
        {error ? (
          <div className="error-banner">
            {error}
            <button type="button" onClick={() => setError(undefined)}>
              ×
            </button>
          </div>
        ) : null}
        {loading ? <div className="empty-state">正在加载工作区…</div> : null}
        {!loading && !opened ? (
          <div className="empty-state">
            <span>W/</span>
            <h1>创建第一个项目</h1>
            <p>在浏览器里编写 HTML、CSS 和 JavaScript，并即时预览结果。</p>
            <button type="button" onClick={() => void handleCreate()}>
              新建项目
            </button>
          </div>
        ) : null}
        {!loading && opened ? (
          <EditorWorkspace
            project={opened.details}
            files={opened.files}
            providerKey={opened.providerKey}
            recoveredDraft={opened.recoveredDraft}
            recoveryMessage={opened.recoveryMessage}
            onVersionChange={(projectId, version, stateVersion) => {
              setOpened((current) =>
                current?.details.id === projectId
                  ? {
                      ...current,
                      recoveredDraft: false,
                      recoveryMessage: undefined,
                      details: { ...current.details, version, stateVersion },
                    }
                  : current,
              )
              setProjects((current) =>
                current.map((item) =>
                  item.id === projectId ? { ...item, version, stateVersion } : item,
                ),
              )
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
          />
        ) : null}
      </section>
    </main>
  )
}
