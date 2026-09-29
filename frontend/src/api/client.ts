import { accessToken, clearAuth, getAccessToken, refreshCredentials } from './auth'

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly retryAfter?: number) { super(message) }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = async (token: string | null) => {
    const headers = new Headers(init.headers)
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return fetch(path, { ...init, credentials: 'omit', headers })
  }
  let response = await send(await accessToken())
  if (response.status === 401 && getAccessToken()) {
    try { response = await send((await refreshCredentials()).accessToken) }
    catch { clearAuth() }
  }
  if (!response.ok) {
    if (response.status === 401) clearAuth()
    const body = await response.json().catch(() => ({})) as { message?: string; code?: string }
    const retry = Number(response.headers.get('Retry-After'))
    throw new ApiError(body.message ?? `请求失败（${response.status}）`, response.status, body.code,
      response.status === 429 && Number.isInteger(retry) ? retry : undefined)
  }
  if (response.status === 204) return undefined as T
  return (await response.json() as { data: T }).data
}
