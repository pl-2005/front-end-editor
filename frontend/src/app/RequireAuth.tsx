import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useSyncExternalStore } from 'react'
import { getAuthStatus, subscribeAuth } from '../api/auth'
import { AuthRecovery } from './AuthRecovery'
import { useAuthUser } from '../hooks/useAuthUser'

export function RequireAuth({ children }: { children: ReactNode }) {
  const user = useAuthUser()
  const status = useSyncExternalStore(subscribeAuth, getAuthStatus)
  const location = useLocation()
  if (status === 'restoring' || status === 'restore-error' || status === 'logout-pending')
    return <AuthRecovery />
  return user ? (
    children
  ) : (
    <Navigate
      to="/login"
      state={{ returnTo: location.pathname + location.search + location.hash }}
      replace
    />
  )
}
