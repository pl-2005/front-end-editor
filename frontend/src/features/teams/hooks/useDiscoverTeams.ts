import { useEffect, useState } from 'react'
import { getAuthUser } from '../../../api/auth'
import * as teams from '../../../api/teams'
import { useAuthUser } from '../../../hooks/useAuthUser'
import type { Team } from '../../../types/team'
import { errorMessage } from '../../../ui/errorMessage'

export function useDiscoverTeams(setError: (error: string) => void) {
  const userId = useAuthUser()?.id
  const [draftQuery, setDraftQuery] = useState('')
  const [query, setQuery] = useState('')
  const [loadedUserId, setLoadedUserId] = useState<number | undefined>(undefined)
  const [pendingUserId, setPendingUserId] = useState<number | undefined>(undefined)
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [loadedPage, setLoadedPage] = useState<number | null>(null)
  const [pageSize, setPageSize] = useState(10)
  const [loadedPageSize, setLoadedPageSize] = useState<number | null>(null)
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<Team[]>([])
  const [pending, setPending] = useState<number[]>([])
  const loading =
    loadedUserId !== userId ||
    loadedQuery !== query ||
    loadedPage !== page ||
    loadedPageSize !== pageSize
  useEffect(() => {
    const nextQuery = draftQuery.trim()
    if (nextQuery === query) return
    const timer = window.setTimeout(() => {
      setQuery(nextQuery)
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [draftQuery, query])
  useEffect(() => {
    const controller = new AbortController()
    void teams
      .discoverTeams(query, page - 1, pageSize, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted && getAuthUser()?.id === userId) {
          setItems(result.content)
          setTotal(result.totalElements)
          setLoadedUserId(userId)
          setLoadedQuery(query)
          setLoadedPage(page)
          setLoadedPageSize(pageSize)
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted && getAuthUser()?.id === userId) {
          setError(errorMessage(error))
          setItems([])
          setLoadedUserId(userId)
          setLoadedQuery(query)
          setLoadedPage(page)
          setLoadedPageSize(pageSize)
        }
      })
    return () => controller.abort()
  }, [query, page, pageSize, setError, userId])
  useEffect(() => {
    const controller = new AbortController()
    void teams
      .listMyJoinRequests(controller.signal)
      .then((requests) => {
        if (!controller.signal.aborted && getAuthUser()?.id === userId) {
          setPendingUserId(userId)
          setPending(requests.map((request) => request.teamId))
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted && getAuthUser()?.id === userId)
          setError(errorMessage(error))
      })
    return () => controller.abort()
  }, [setError, userId])
  return {
    draftQuery,
    setDraftQuery,
    query,
    setQuery,
    page,
    setPage,
    pageSize,
    setPageSize,
    loadedQuery,
    total,
    items,
    pending: pendingUserId === userId ? pending : [],
    setPending,
    loading,
  }
}
