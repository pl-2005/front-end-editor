import { useSyncExternalStore } from 'react'
import { getAuthUser, subscribeAuth } from '../api/auth'

export function useAuthUser() {
  return useSyncExternalStore(subscribeAuth, getAuthUser)
}
