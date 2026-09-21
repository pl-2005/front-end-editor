import { useState } from 'react'
import { listRevisions, restoreRevision } from '../api/projects'
import type { ProjectRevision } from '../types/project'

interface Props {
  projectId: number
  currentVersion: number
  hasUnsavedChanges: boolean
  onRestored: () => void
}

const formatDate = (value: string) => new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date(value))

const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`

export function RevisionHistory({ projectId, currentVersion, hasUnsavedChanges, onRestored }: Props) {
  const [open, setOpen] = useState(false)
  const [revisions, setRevisions] = useState<ProjectRevision[]>([])
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState<number>()
  const [error, setError] = useState<string>()

  const toggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setLoading(true)
    setError(undefined)
    void listRevisions(projectId)
      .then(setRevisions)
      .catch((cause) => setError(cause instanceof Error ? cause.message : '版本列表加载失败'))
      .finally(() => setLoading(false))
  }

  const restore = async (revision: ProjectRevision) => {
    const warning = hasUnsavedChanges ? '当前未保存更改会被放弃。' : ''
    if (!window.confirm(`${warning}确定恢复版本 ${revision.version}？恢复操作会创建一个新版本。`)) return
    setRestoring(revision.version)
    setError(undefined)
    try {
      await restoreRevision(projectId, revision.version, currentVersion)
      setOpen(false)
      onRestored()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '版本恢复失败')
    } finally {
      setRestoring(undefined)
    }
  }

  return <div className="revision-history">
    <button type="button" onClick={toggle} aria-expanded={open}>版本历史</button>
    {open ? <aside className="revision-popover" aria-label="版本历史">
      <div className="revision-title"><strong>版本历史</strong><button type="button" onClick={() => setOpen(false)}>×</button></div>
      {error ? <p className="revision-error">{error}</p> : null}
      {loading ? <p className="revision-empty">正在加载…</p> : null}
      {!loading && revisions.length === 0 ? <p className="revision-empty">暂无已保存版本</p> : null}
      <ol>{revisions.map((revision) => <li key={revision.version}>
        <div><strong>版本 {revision.version}</strong>{revision.current ? <span>当前</span> : null}<small>{formatDate(revision.createdAt)} · {formatSize(revision.sizeBytes)}</small></div>
        {!revision.current ? <button type="button" disabled={restoring !== undefined} onClick={() => void restore(revision)}>{restoring === revision.version ? '恢复中…' : '恢复'}</button> : null}
      </li>)}</ol>
    </aside> : null}
  </div>
}
