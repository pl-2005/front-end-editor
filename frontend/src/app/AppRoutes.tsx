import { Navigate, Route, Routes } from 'react-router-dom'
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
  return (
    <Routes>
      <Route path="/invite" element={<LegacyInvitePage />} />
      <Route
        path="/login"
        element={user ? <Navigate to="/teams" replace /> : <AuthPage key="login" mode="login" />}
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
