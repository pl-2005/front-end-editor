import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect, useSyncExternalStore } from 'react'
import { getAuthStatus, restoreSession, subscribeAuth } from '../api/auth'
import { AuthRecovery } from './AuthRecovery'
import { safeReturnTo } from '../api/returnTo'
import { AuthPage } from '../features/auth/pages/AuthPage'
import { LegacyInvitePage } from '../features/auth/pages/LegacyInvitePage'
import { InvitationsPage } from '../features/invitations/pages/InvitationsPage'
import { DiscoverPage } from '../features/teams/pages/DiscoverPage'
import { TeamListPage } from '../features/teams/pages/TeamListPage'
import { useAuthUser } from '../hooks/useAuthUser'
import { RequireAuth } from './RequireAuth'
import { ProjectRoute, TeamRoute } from './RouteEntries'
export function AppRoutes() {
  const user = useAuthUser()
  const status = useSyncExternalStore(subscribeAuth, getAuthStatus)
  const location = useLocation()
  useEffect(() => {
    void restoreSession()
  }, [])
  if (
    status === 'restoring' ||
    ((status === 'restore-error' || status === 'logout-pending') &&
      !['/login', '/register', '/invite'].includes(location.pathname))
  )
    return <AuthRecovery />
  return (
    <Routes>
      <Route path="/invite" element={<LegacyInvitePage />} />
      <Route
        path="/login"
        element={
          user && !location.state?.reauthenticate ? (
            <Navigate to={safeReturnTo(location.state?.returnTo)} replace />
          ) : (
            <AuthPage key="login" mode="login" />
          )
        }
      />
      <Route
        path="/register"
        element={
          user ? <Navigate to="/teams" replace /> : <AuthPage key="register" mode="register" />
        }
      />
      <Route
        path="/teams"
        element={
          <RequireAuth>
            <TeamListPage />
          </RequireAuth>
        }
      />
      <Route
        path="/discover"
        element={
          <RequireAuth>
            <DiscoverPage />
          </RequireAuth>
        }
      />
      <Route
        path="/invitations"
        element={
          <RequireAuth>
            <InvitationsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/teams/:teamId"
        element={
          <RequireAuth>
            <TeamRoute />
          </RequireAuth>
        }
      />
      <Route
        path="/teams/:teamId/projects/:projectId"
        element={
          <RequireAuth>
            <ProjectRoute />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to={user ? '/teams' : '/login'} replace />} />
    </Routes>
  )
}
