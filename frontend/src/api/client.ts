import { accessToken, clearAuth, getAccessToken, getAuthSession, refreshCredentials } from './auth'

export class ApiError extends Error {
  /**
   * 记录 API 错误的 HTTP 状态、业务码、限流等待时间及可重试的初始化项目 ID。
   *
   * @param message 错误或业务说明
   * @param status HTTP 状态码
   * @param code 业务错误码
   * @param retryAfter 允许重试前的等待秒数
   * @param initializingProjectId 初始化失败时已预留的项目 ID
   */
  constructor(message: string, readonly status: number, readonly code?: string, readonly retryAfter?: number,
    readonly initializingProjectId?: number) { super(message) }
}

/**
 * 携带内存访问令牌发送请求，401 时最多刷新并重试一次；检查会话代次，统一解析业务错误及响应 data。
 *
 * @param path 目标路径
 * @param init fetch 请求选项
 * @returns 响应 data；HTTP 204 时为 undefined
 */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = getAuthSession()
  /**
   * 合并请求头并注入访问令牌，禁止发送 Cookie，返回原始 HTTP 响应。
   *
   * @param token 访问令牌，未登录时可为空
   * @returns 尚未解析的 HTTP 响应
   */
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
    const initializingId = Number(response.headers.get('X-Initializing-Project'))
    throw new ApiError(body.message ?? `请求失败（${response.status}）`, response.status, body.code,
      response.status === 429 && Number.isInteger(retry) ? retry : undefined,
      body.code === 'COLLAB_INITIALIZATION_FAILED' && Number.isSafeInteger(initializingId) && initializingId > 0 ? initializingId : undefined)
  }
  if (response.status === 204) return undefined as T
  return (await response.json() as { data: T }).data
}
