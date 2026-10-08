import { DownloadOutlined } from '@ant-design/icons'
import { Button, Card, Empty, Table, Tag, Tooltip } from 'antd'
import { Link } from 'react-router-dom'
import type { TeamProjectSummary } from '../../../types/collaboration'
import { ProjectActionButtons } from '../../projects/components/ProjectActionButtons'
import { ProjectInitializationRetry } from '../../projects/components/ProjectInitializationRetry'
export function TeamProjectsPanel({
  teamId,
  projects,
  busy,
  canExport,
  initializingId,
  onCreate,
  onRetry,
  onEdit,
  onCopy,
  onDelete,
  onExport,
  onOpen,
}: {
  teamId: number
  projects: TeamProjectSummary[]
  busy: boolean
  canExport: boolean
  initializingId: number | null
  onCreate: () => void
  onRetry: () => void
  onEdit: (project: TeamProjectSummary) => void
  onCopy: (project: TeamProjectSummary) => void
  onDelete: (project: TeamProjectSummary) => void
  onExport: (project: TeamProjectSummary) => void
  onOpen: (project: TeamProjectSummary) => void
}) {
  return (
    <section className="v2-team-management-column" aria-labelledby="team-projects-heading">
      <div className="v2-team-management-heading">
        <h2 id="team-projects-heading">项目管理</h2>
        <Tag>{projects.length} 个项目</Tag>
      </div>
      <Card className="v2-panel">
        <div className="v2-team-project-heading">
          <h3>团队项目</h3>
          <Button
            type="primary"
            className="v2-primary-button"
            htmlType="button"
            disabled={busy}
            onClick={onCreate}
          >
            创建项目
          </Button>
        </div>
        {initializingId ? <ProjectInitializationRetry busy={busy} onRetry={onRetry} /> : null}
        <Table<TeamProjectSummary>
          className="v2-project-table"
          rowKey="id"
          dataSource={projects}
          rowClassName="v2-team-row"
          onRow={(project) => ({
            tabIndex: 0,
            'aria-label': `查看项目 ${project.name}`,
            onClick: () => onOpen(project),
            onKeyDown: (event) => {
              if (event.target !== event.currentTarget) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onOpen(project)
              }
            },
          })}
          pagination={false}
          tableLayout="fixed"
          scroll={{ x: 600 }}
          locale={{ emptyText: <Empty description="暂无项目。" /> }}
          columns={[
            {
              title: '项目名称',
              dataIndex: 'name',
              width: '20%',
              ellipsis: true,
              render: (name: string, project) => (
                <Link to={`/teams/${teamId}/projects/${project.id}`} title={name}>
                  {name}
                </Link>
              ),
            },
            {
              title: '项目描述',
              dataIndex: 'description',
              ellipsis: true,
              render: (description: string | null) => (
                <span className="v2-project-table-description" title={description || '暂无描述'}>
                  {description || '暂无描述'}
                </span>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              width: 200,
              align: 'center',
              render: (_, project) => (
                <div
                  className="v2-actions v2-project-table-actions"
                  onClick={(event) => event.stopPropagation()}
                >
                  <ProjectActionButtons
                    busy={busy}
                    onEdit={() => onEdit(project)}
                    onCopy={() => onCopy(project)}
                    onDelete={() => onDelete(project)}
                    exportAction={
                      <Tooltip title="导出项目">
                        <Button
                          htmlType="button"
                          type="text"
                          icon={<DownloadOutlined />}
                          aria-label="导出项目"
                          disabled={busy || !canExport}
                          onClick={() => onExport(project)}
                        />
                      </Tooltip>
                    }
                  />
                </div>
              ),
            },
          ]}
        />
      </Card>
    </section>
  )
}
