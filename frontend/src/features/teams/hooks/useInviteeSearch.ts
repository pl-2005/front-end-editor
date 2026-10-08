import { useEffect, useRef, useState } from 'react'
import * as teams from '../../../api/teams'
import type { Invitee } from '../../../types/team'
import { errorMessage } from '../../../ui/errorMessage'

export function useInviteeSearch(
  teamId: number,
  isOwner: boolean,
  setError: (error: string) => void,
) {
  const [inviteIdentifier, setInviteIdentifier] = useState('')
  const [invitees, setInvitees] = useState<Invitee[]>([])
  const [inviteSearchComplete, setInviteSearchComplete] = useState(false)
  const [inviteSearching, setInviteSearching] = useState(false)
  const inviteSearchVersion = useRef(0)
  useEffect(() => {
    const query = inviteIdentifier.trim()
    if (!query || !isOwner) return
    const controller = new AbortController()
    const version = inviteSearchVersion.current
    const timer = window.setTimeout(() => {
      setInviteSearching(true)
      void teams
        .searchInvitees(teamId, query, controller.signal)
        .then((found) => {
          if (controller.signal.aborted || version !== inviteSearchVersion.current) return
          setInvitees(found)
          setInviteSearchComplete(true)
        })
        .catch((error) => {
          if (!controller.signal.aborted && version === inviteSearchVersion.current)
            setError(errorMessage(error))
        })
        .finally(() => {
          if (!controller.signal.aborted && version === inviteSearchVersion.current)
            setInviteSearching(false)
        })
    }, 300)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [inviteIdentifier, isOwner, teamId, setError])
  const changeIdentifier = (value: string) => {
    inviteSearchVersion.current++
    setInviteIdentifier(value)
    setInvitees([])
    setInviteSearchComplete(false)
    setInviteSearching(false)
  }
  const afterIssue = (userId: number) => {
    const version = inviteSearchVersion.current
    return () => {
      if (version === inviteSearchVersion.current)
        setInvitees((found) => found.filter((value) => value.userId !== userId))
    }
  }
  return {
    inviteIdentifier,
    changeIdentifier,
    invitees,
    inviteSearchComplete,
    inviteSearching,
    afterIssue,
  }
}
