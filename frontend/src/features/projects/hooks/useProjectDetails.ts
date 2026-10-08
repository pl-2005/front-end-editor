import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuthUser } from '../../../api/auth'
import * as teams from '../../../api/teams'
import type { TeamProjectDetails, TeamProjectSummary } from '../../../types/collaboration'
import { errorMessage } from '../../../ui/errorMessage'
import { useFeedback } from '../../../ui/useNotice'
export function useProjectDetails(teamId: number, projectId: number, userId: number | undefined) {
  const [project, setProject] = useState<TeamProjectDetails | null>(null)
  const [loadError, setLoadError] = useState('')
  const [snapshotKey, setSnapshotKey] = useState<string | null>(null)
  const currentKey = `${teamId}:${projectId}:${userId}`
  const pending = useRef<AbortController | null>(null)
  const clear = useCallback(() => {
    pending.current?.abort()
    setProject(null)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    pending.current = controller
    void teams
      .getTeamProject(teamId, projectId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted && getAuthUser()?.id === userId) {
          setSnapshotKey(`${teamId}:${projectId}:${userId}`)
          setProject(next)
          setLoadError('')
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted && getAuthUser()?.id === userId)
          setLoadError(errorMessage(error))
      })
    return () => controller.abort()
  }, [teamId, projectId, userId])
  useFeedback({ error: loadError })
  const update = (summary: TeamProjectSummary) =>
    setProject((current) =>
      current && current.id === summary.id ? { ...current, ...summary } : current,
    )
  return { project: snapshotKey === currentKey ? project : null, clear, update }
}
