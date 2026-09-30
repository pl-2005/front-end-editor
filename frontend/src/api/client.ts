import { accessToken, clearAuth, getAccessToken, getAuthSession, refreshCredentials } from './auth'

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly retryAfter?: number) { super(message) }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = getAuthSession()
  const send = async (token: string | null) => {
    const headers = new Headers(init.headers)
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return fetch(path, { ...init, credentials: 'omit', headers })
  }
  let token = await accessToken()
  if (session !== getAuthSession()) throw new Error('登录状态已变化')
  let response = await send(token)
  if (session !== getAuthSession()) throw new Error('登录状态已变化')
  if (response.status === 401 && token && getAccessToken()) {
    try {
      token = getAccessToken() === token ? (await refreshCredentials()).accessToken : getAccessToken()
      response = await send(token)
      if (session !== getAuthSession()) throw new Error('登录状态已变化')
    } catch { if (getAccessToken() === token) clearAuth() }
  }
  if (!response.ok) {
    if (response.status === 401 && token && getAccessToken() === token) clearAuth()
    const body = await response.json().catch(() => ({})) as { message?: string; code?: string }
    const retry = Number(response.headers.get('Retry-After'))
    throw new ApiError(body.message ?? `请求失败（${response.status}）`, response.status, body.code,
      response.status === 429 && Number.isInteger(retry) ? retry : undefined)
  }
  if (response.status === 204) return undefined as T
  return (await response.json() as { data: T }).data
}
