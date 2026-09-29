import type { Credentials, User } from '../types/auth'

let credentials: Credentials | null = null
let expiresAt = 0
let refreshPromise: Promise<Credentials> | null = null
const listeners = new Set<() => void>()

function notify() { listeners.forEach((listener) => listener()) }
export function subscribeAuth(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function getAuthUser() { return credentials?.user ?? null }
export function getAccessToken() { return credentials?.accessToken ?? null }
export function clearAuth() { credentials = null; expiresAt = 0; notify() }
export function setCredentials(next: Credentials) { credentials = next; expiresAt = Date.now() + next.expiresIn * 1000; notify() }

async function authRequest<T>(path: string, body: object): Promise<T> {
  const response = await fetch(path, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string }
    throw new Error(payload.message ?? `请求失败（${response.status}）`)
  }
  return (await response.json() as { data: T }).data
}
export async function register(username: string, email: string, password: string, displayName?: string) {
  return authRequest<User>('/api/auth/register', { username, email: email || null, password, displayName })
}
export async function login(loginName: string, password: string) {
  const next = await authRequest<Credentials>('/api/auth/login', { login: loginName, password })
  try {
    const response = await fetch('/api/auth/me', { credentials: 'omit', headers: { Authorization: `Bearer ${next.accessToken}` } })
    if (!response.ok) throw new Error('登录状态校验失败')
    const user = (await response.json() as { data: User }).data
    setCredentials({ ...next, user })
  } catch (error) { clearAuth(); throw error }
  return next
}
export async function refreshCredentials() {
  if (!credentials) throw new Error('需要登录')
  if (!refreshPromise) {
    refreshPromise = authRequest<Credentials>('/api/auth/refresh', { refreshToken: credentials.refreshToken })
      .then((next) => { setCredentials(next); return next })
      .catch((error) => { clearAuth(); throw error })
      .finally(() => { refreshPromise = null })
  }
  return refreshPromise
}
export async function accessToken() {
  if (!credentials) return null
  if (Date.now() >= expiresAt - 30_000) await refreshCredentials()
  return credentials?.accessToken ?? null
}
export async function logout() {
  try {
    const token = await accessToken()
    if (token) await fetch('/api/auth/logout', { method: 'POST', credentials: 'omit', headers: { Authorization: `Bearer ${token}` } })
  } finally { clearAuth() }
}
export async function changePassword(currentPassword: string, newPassword: string) {
  const token = await accessToken()
  if (!token) throw new Error('需要登录')
  const response = await fetch('/api/auth/password', { method: 'PUT', credentials: 'omit',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }) })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string }
    throw new Error(payload.message ?? `请求失败（${response.status}）`)
  }
  clearAuth()
}
