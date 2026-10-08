import { useState } from 'react'
import { ApiError } from '../../../api/client'
import * as teams from '../../../api/teams'
import type { TeamProjectSummary } from '../../../types/collaboration'
import type { MetadataValues } from '../../../ui/MetadataFields'
import { useDialogs } from '../../../ui/useDialogs'

export type ProjectExecutor = (operation: () => Promise<void>, success?: string) => Promise<void>
/** Uses the page's executor, including its permission policy and its single task lock. */
export function useProjectActions({
  teamId,
  busy,
  execute,
  onCopied,
  onDeleted,
  onUpdated,
  onInitialized,
  copySuccess,
  deleteSuccess,
}: {
  teamId: number
  busy: boolean
  execute: ProjectExecutor
  onCopied: (project: TeamProjectSummary) => void | Promise<void>
  onDeleted: (project: TeamProjectSummary) => void | Promise<void>
  onUpdated: (project: TeamProjectSummary) => void | Promise<void>
  onInitialized: (project: TeamProjectSummary) => void | Promise<void>
  copySuccess?: string
  deleteSuccess?: string
}) {
  const dialogs = useDialogs()
  const [editingProject, setEditingProject] = useState<TeamProjectSummary | null>(null)
  const [initializingId, setInitializingId] = useState<number | null>(null)
  const rememberInitialization = (error: unknown) => {
    if (error instanceof ApiError && error.initializingProjectId)
      setInitializingId(error.initializingProjectId)
  }
  const copy = async (project: TeamProjectSummary) => {
    if (busy) return
    const name = await dialogs.prompt('副本名称', `${project.name} 副本`)
    if (!name) return
    await execute(async () => {
      let copy: TeamProjectSummary
      try {
        copy = await teams.copyTeamProject(teamId, project.id, name)
      } catch (error) {
        rememberInitialization(error)
        throw error
      }
      await onCopied(copy)
    }, copySuccess)
  }
  const remove = async (project: TeamProjectSummary) => {
    if (busy || !(await dialogs.confirm(`确定删除项目“${project.name}”？删除后无法恢复。`))) return
    await execute(async () => {
      await teams.deleteTeamProject(teamId, project)
      await onDeleted(project)
    }, deleteSuccess)
  }
  const save = (values: MetadataValues) => {
    if (busy || !editingProject) return
    void execute(async () => {
      const next = await teams.updateTeamProject(
        teamId,
        editingProject,
        values.name,
        values.description,
      )
      await onUpdated(next)
      setEditingProject(null)
    }, '项目已更新。')
  }
  const retry = () => {
    if (busy || !initializingId) return
    void execute(async () => {
      const project = await teams.retryTeamProjectInitialization(teamId, initializingId)
      await onInitialized(project)
      setInitializingId(null)
    })
  }
  return {
    editingProject,
    edit: (project: TeamProjectSummary) => {
      if (!busy) setEditingProject(project)
    },
    cancelEdit: () => setEditingProject(null),
    initializingId,
    rememberInitialization,
    copy,
    remove,
    save,
    retry,
    holder: dialogs.holder,
  }
}
