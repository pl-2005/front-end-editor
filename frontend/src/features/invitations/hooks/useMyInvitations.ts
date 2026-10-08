import { useEffect, useState } from 'react'
import { getAuthUser } from '../../../api/auth'
import * as teams from '../../../api/teams'
import { useAuthUser } from '../../../hooks/useAuthUser'
import type { MyInvitation } from '../../../types/team'
import { errorMessage } from '../../../ui/errorMessage'
import { useFeedback } from '../../../ui/useNotice'

export function useMyInvitations() {
  const userId = useAuthUser()?.id
  const [items, setItems] = useState<MyInvitation[]>([])
  const [loadedUserId, setLoadedUserId] = useState<number | undefined>(undefined)
  const loaded = userId !== undefined && loadedUserId === userId
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void teams
      .listMyInvitations(controller.signal)
      .then((invitations) => {
        if (controller.signal.aborted || getAuthUser()?.id !== userId) return
        setItems(invitations)
        setLoadedUserId(userId)
      })
      .catch((error) => {
        if (!controller.signal.aborted && getAuthUser()?.id === userId) {
          setLoadError(errorMessage(error))
          setLoadedUserId(userId)
        }
      })
    return () => controller.abort()
  }, [userId])
  useFeedback({ error: loadError })
  return { items: loaded ? items : [], setItems, loaded }
}
