import { Card } from 'antd'
import type { TeamProjectDetails } from '../../../types/collaboration'
import { ProjectActionButtons } from './ProjectActionButtons'
import { ProjectInitializationRetry } from './ProjectInitializationRetry'
export function ProjectHeader({
  project,
  busy,
  initializingId,
  onEdit,
  onCopy,
  onDelete,
  onRetry,
  onExportTarget,
}: {
  project: TeamProjectDetails | null
  busy: boolean
  initializingId: number | null
  onEdit: () => void
  onCopy: () => void
  onDelete: () => void
  onRetry: () => void
  onExportTarget: (target: HTMLSpanElement | null) => void
}) {
  return (
    <Card className="v2-panel">
      <div className="v2-project-bar">
        <h1>{project?.name ?? '正在加载项目…'}</h1>
        {project ? (
          <div className="v2-actions">
            <ProjectActionButtons
              size="header"
              busy={busy}
              onEdit={onEdit}
              onCopy={onCopy}
              onDelete={onDelete}
              exportAction={<span ref={onExportTarget} />}
              retryAction={
                initializingId ? (
                  <ProjectInitializationRetry busy={busy} onRetry={onRetry} presentation="icon" />
                ) : undefined
              }
            />
          </div>
        ) : null}
      </div>
      {project ? (
        <p className="v2-project-description">{project.description || '暂无描述'}</p>
      ) : null}
    </Card>
  )
}
