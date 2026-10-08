import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthUser } from '../hooks/useAuthUser'

export function RequireAuth({ children }: { children: ReactNode }) {
  return useAuthUser() ? children : <Navigate to="/login" replace />
}
