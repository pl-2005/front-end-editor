import { Tag } from 'antd'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../../api/client'
import * as teams from '../../../api/teams'
import { AppShell } from '../../../app/AppShell'
import { useAuthUser } from '../../../hooks/useAuthUser'
import { useTask } from '../../../hooks/useTask'
import { MetadataDialog } from '../../../ui/MetadataDialog'
import { useDialogs } from '../../../ui/useDialogs'
import { useProjectActions } from '../../projects/hooks/useProjectActions'
import { TeamHeader } from '../components/TeamHeader'
import { TeamInvitationsPanel } from '../components/TeamInvitationsPanel'
import { TeamJoinRequestsPanel } from '../components/TeamJoinRequestsPanel'
import { TeamMembersPanel } from '../components/TeamMembersPanel'
import { TeamProjectsPanel } from '../components/TeamProjectsPanel'
import { useTeamDetails } from '../hooks/useTeamDetails'

export function TeamPage() {
  const dialogs = useDialogs()
  const teamId = Number(useParams().teamId)
  const user = useAuthUser()
  const navigate = useNavigate()
  const task = useTask()
  const {
    team,
    setTeam,
    members,
    projects,
    setProjects,
    requests,
    invitations,
    isOwner,
    reload,
    clear,
  } = useTeamDetails(teamId, user?.id)
  const [creatingProject, setCreatingProject] = useState(false)
  const [editingTeam, setEditingTeam] = useState(false)
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
          clear()
          navigate('/teams', { replace: true })
        }
        throw error
      }
    }, success)
  const projectActions = useProjectActions({
    teamId,
    busy: task.busy,
    execute: runTeam,
    onCopied: async () => {
      await reload()
    },
    onDeleted: async () => {
      await reload()
    },
    onUpdated: (next) =>
      setProjects((current) => current.map((item) => (item.id === next.id ? next : item))),
    onInitialized: (project) => navigate(`/teams/${teamId}/projects/${project.id}`),
    copySuccess: '项目已复制。',
    deleteSuccess: '项目已删除。',
  })
  return (
    <AppShell>
      <section className="v2-section">
        <TeamHeader
          team={team}
          isOwner={isOwner}
          busy={task.busy}
          onEdit={() => setEditingTeam(true)}
          onPolicyChange={(policy) =>
            void runTeam(async () => {
              setTeam(await teams.setJoinPolicy(teamId, policy))
            })
          }
        />

        {team ? (
          <div className="v2-team-management">
            <section className="v2-team-management-column" aria-labelledby="team-members-heading">
              <div className="v2-team-management-heading">
                <h2 id="team-members-heading">成员管理</h2>
                <Tag>{members.length} 位成员</Tag>
              </div>
              <TeamMembersPanel
                members={members}
                isOwner={isOwner}
                busy={task.busy}
                onTransfer={(userId) =>
                  void runTeam(async () => {
                    await teams.transferOwner(teamId, userId)
                    await reload()
                  })
                }
                onRemove={(userId) =>
                  void runTeam(async () => {
                    await teams.removeMember(teamId, userId)
                    await reload()
                  })
                }
                onLeave={async () => {
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
              />
              {isOwner ? (
                <>
                  <TeamJoinRequestsPanel
                    requests={requests}
                    busy={task.busy}
                    onDecide={(requestId, decision) =>
                      void runTeam(async () => {
                        await teams.decideJoin(teamId, requestId, decision)
                        await reload()
                      })
                    }
                  />
                  <TeamInvitationsPanel
                    teamId={teamId}
                    invitations={invitations}
                    busy={task.busy}
                    onError={task.setError}
                    onIssue={(userId, onIssued) =>
                      void runTeam(async () => {
                        await teams.issueInvitation(teamId, userId)
                        await reload()
                        onIssued()
                      }, '邀请已发送，受邀人可在“我的邀请”中处理。')
                    }
                    onRevoke={(invitationId) =>
                      void runTeam(async () => {
                        await teams.revokeInvitation(teamId, invitationId)
                        await reload()
                      })
                    }
                  />
                </>
              ) : null}
            </section>
            <TeamProjectsPanel
              teamId={teamId}
              projects={projects}
              busy={task.busy}
              canExport={!!user}
              initializingId={projectActions.initializingId}
              onCreate={() => setCreatingProject(true)}
              onRetry={projectActions.retry}
              onEdit={projectActions.edit}
              onCopy={projectActions.copy}
              onDelete={projectActions.remove}
              onOpen={(project) => navigate(`/teams/${teamId}/projects/${project.id}`)}
              onExport={(project) => {
                if (!user) return
                void runTeam(async () => {
                  const { exportTeamProject } =
                    await import('../../../collaboration/exportTeamProject')
                  await exportTeamProject(teamId, project.id, user.id)
                })
              }}
            />
          </div>
        ) : null}
        {editingTeam && isOwner && team ? (
          <MetadataDialog
            key={team.id}
            initialValues={team}
            kind="团队"
            busy={task.busy}
            onCancel={() => setEditingTeam(false)}
            onSubmit={({ name, description }) => {
              void runTeam(async () => {
                const next = await teams.updateTeam(teamId, name, description)
                setTeam(next)
                setEditingTeam(false)
              }, '团队已更新。')
            }}
          />
        ) : null}
        {projectActions.editingProject ? (
          <MetadataDialog
            key={projectActions.editingProject.id}
            initialValues={projectActions.editingProject}
            busy={task.busy}
            onCancel={projectActions.cancelEdit}
            onSubmit={projectActions.save}
          />
        ) : null}
        {creatingProject ? (
          <MetadataDialog
            kind="项目"
            mode="create"
            initialValues={{ name: '', description: '' }}
            busy={task.busy}
            onCancel={() => setCreatingProject(false)}
            onSubmit={(values) => {
              void runTeam(async () => {
                try {
                  const project = await teams.createTeamProject(
                    teamId,
                    values.name.trim(),
                    values.description?.trim() || null,
                  )
                  setCreatingProject(false)
                  navigate(`/teams/${teamId}/projects/${project.id}`)
                } catch (error) {
                  projectActions.rememberInitialization(error)
                  if (error instanceof ApiError && error.initializingProjectId)
                    setCreatingProject(false)
                  throw error
                }
              })
            }}
          />
        ) : null}
        {projectActions.holder}
        {dialogs.holder}
      </section>
    </AppShell>
  )
}
