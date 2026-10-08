import { Spin } from 'antd'
import { lazy, Suspense, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../../api/client'
import { AppShell } from '../../../app/AppShell'
import { RouteBreadcrumb } from '../../../app/RouteBreadcrumb'
import { useAuthUser } from '../../../hooks/useAuthUser'
import { useTask } from '../../../hooks/useTask'
import { MetadataDialog } from '../../../ui/MetadataDialog'
import { ProjectHeader } from '../components/ProjectHeader'
import { useProjectActions } from '../hooks/useProjectActions'
import { useProjectDetails } from '../hooks/useProjectDetails'
const ProjectWorkspace = lazy(() => import('../../../editor/v2/ProjectWorkspace'))

export function ProjectPage() {
  const user = useAuthUser()
  const teamId = Number(useParams().teamId)
  const projectId = Number(useParams().projectId)
  const task = useTask()
  const navigate = useNavigate()
  const { project, clear, update } = useProjectDetails(teamId, projectId, user?.id)
  const [exportTarget, setExportTarget] = useState<HTMLSpanElement | null>(null)
  const runProject = (operation: () => Promise<void>, success?: string) =>
    task.run(async () => {
      try {
        await operation()
      } catch (error) {
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          clear()
          navigate('/teams', { replace: true })
        }
        throw error
      }
    }, success)
  const actions = useProjectActions({
    teamId,
    busy: task.busy,
    execute: runProject,
    onCopied: (copy) => navigate(`/teams/${teamId}/projects/${copy.id}`),
    onDeleted: () => {
      clear()
      navigate(`/teams/${teamId}`, { replace: true })
    },
    onUpdated: update,
    onInitialized: (copy) => navigate(`/teams/${teamId}/projects/${copy.id}`),
  })
  return (
    <AppShell>
      <section className="v2-section v2-project-section">
        <div className="v2-heading">
          <RouteBreadcrumb parentPath={`/teams/${teamId}`}>
            <Link to="/teams">我的团队</Link> / <Link to={`/teams/${teamId}`}>团队</Link> /{' '}
            <span aria-current="page">项目</span>
          </RouteBreadcrumb>
        </div>
        <ProjectHeader
          project={project}
          busy={task.busy}
          initializingId={actions.initializingId}
          onEdit={() => {
            if (project) actions.edit(project)
          }}
          onCopy={() => {
            if (project) void actions.copy(project)
          }}
          onDelete={() => {
            if (project) void actions.remove(project)
          }}
          onRetry={actions.retry}
          onExportTarget={setExportTarget}
        />
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
        {actions.editingProject && project ? (
          <MetadataDialog
            key={actions.editingProject.id}
            initialValues={actions.editingProject}
            busy={task.busy}
            onCancel={actions.cancelEdit}
            onSubmit={actions.save}
          />
        ) : null}
        {actions.holder}
      </section>
    </AppShell>
  )
}
