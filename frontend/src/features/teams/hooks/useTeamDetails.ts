import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuthUser } from '../../../api/auth'
import { ApiError } from '../../../api/client'
import * as teams from '../../../api/teams'
import type { TeamProjectSummary } from '../../../types/collaboration'
import type { Invitation, JoinRequest, Member, Team } from '../../../types/team'
import { errorMessage } from '../../../ui/errorMessage'
import { useFeedback } from '../../../ui/useNotice'

/** One snapshot per team. Every reload invalidates all earlier base and owner requests. */
export function useTeamDetails(teamId: number, userId: number | undefined) {
  const [team, setTeam] = useState<Team | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [projects, setProjects] = useState<TeamProjectSummary[]>([])
  const [requests, setRequests] = useState<JoinRequest[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loadError, setLoadError] = useState('')
  const [snapshotKey, setSnapshotKey] = useState<string | null>(null)
  const currentKey = `${teamId}:${userId}`
  const generation = useRef(0)
  const pending = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  const invalidate = useCallback(() => {
    generation.current++
    pending.current?.abort()
  }, [])
  const clear = useCallback(() => {
    invalidate()
    setTeam(null)
    setMembers([])
    setProjects([])
    setRequests([])
    setInvitations([])
  }, [invalidate])
  const reload = useCallback(
    async (initial = false) => {
      invalidate()
      const version = generation.current
      const controller = new AbortController()
      pending.current = controller
      const valid = () =>
        mounted.current &&
        !controller.signal.aborted &&
        generation.current === version &&
        getAuthUser()?.id === userId
      try {
        const [nextTeam, nextMembers, nextProjects] = await Promise.all([
          teams.getTeam(teamId, controller.signal),
          teams.listMembers(teamId, controller.signal),
          teams.listTeamProjects(teamId, controller.signal),
        ])
        if (!valid()) return
        setLoadError('')
        setSnapshotKey(`${teamId}:${userId}`)
        setTeam(nextTeam)
        setMembers(nextMembers)
        setProjects(nextProjects.items)
        if (nextMembers.some((member) => member.userId === userId && member.role === 'OWNER')) {
          const [nextRequests, nextInvitations] = await Promise.all([
            teams.listJoinRequests(teamId, controller.signal),
            teams.listInvitations(teamId, controller.signal),
          ])
          if (!valid()) return
          setRequests(nextRequests)
          setInvitations(nextInvitations)
        } else {
          setRequests([])
          setInvitations([])
        }
      } catch (error) {
        if (!valid()) return
        if (!initial) throw error
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) clear()
        setLoadError(errorMessage(error))
      }
    },
    [teamId, userId, invalidate, clear],
  )
  useEffect(() => {
    mounted.current = true
    void Promise.resolve().then(() => {
      if (mounted.current) return reload(true)
    })
    return () => {
      mounted.current = false
      invalidate()
    }
  }, [reload, invalidate])
  useFeedback({ error: loadError })
  const current = snapshotKey === currentKey
  const isOwner =
    current && members.some((member) => member.userId === userId && member.role === 'OWNER')
  return {
    team: current ? team : null,
    setTeam,
    members: current ? members : [],
    projects: current ? projects : [],
    setProjects,
    requests: current ? requests : [],
    invitations: current ? invitations : [],
    isOwner,
    reload,
    clear,
  }
}
