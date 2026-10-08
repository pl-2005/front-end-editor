import type { Credentials, User } from '../types/auth'
import { purgeUserCaches } from '../collaboration/offline'
import { getResponseMessage } from './responseMessage'

export type AuthStatus =
  'restoring' | 'authenticated' | 'anonymous' | 'restore-error' | 'logout-pending'
export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly code?: string,
    readonly retryAfter?: number,
  ) {
    super(message)
  }
}
const markerKey = 'web-editor-auth-session-v1'
const lockName = 'web-editor-auth-session'
const timeout = 15_000
let credentials: Credentials | null = null
let expiresAt = 0
let refreshPromise: Promise<Credentials> | null = null
let restorePromise: Promise<void> | null = null
let generation = 0
let sessionGeneration = 0
let status: AuthStatus = 'restoring'
let errorMessage = ''
let retryAt = 0
let refreshNeedsConfirmation = false
let marker = 'initial'
let initialized = false
let channel: BroadcastChannel | undefined
const listeners = new Set<() => void>()
function notify() {
  listeners.forEach((listener) => listener())
}
export function subscribeAuth(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function getAuthStatus() {
  return status
}
export function getAuthError() {
  return errorMessage
}
function readMarker() {
  return localStorage.getItem(markerKey) ?? 'initial'
}
function dropIdentity(next: AuthStatus) {
  const userId = credentials?.user.id
  generation++
  sessionGeneration++
  credentials = null
  expiresAt = 0
  refreshPromise = null
  status = next
  notify()
  if (userId) void purgeUserCaches(userId).catch(() => {})
}
function synchronize() {
  if (!initialized) return
  try {
    const current = readMarker()
    if (current !== marker) {
      marker = current
      dropIdentity(current.startsWith('pending:') ? 'logout-pending' : 'anonymous')
    }
  } catch {
    const message = '浏览器无法安全协调登录会话，请允许站点存储后重试'
    if (errorMessage !== message) {
      errorMessage = message
      notify()
    }
  }
}
function initialize() {
  if (!navigator.locks)
    throw new AuthError('此浏览器不支持安全会话协调，请使用支持 Web Locks 的浏览器')
  const probe = `${markerKey}-probe-${crypto.randomUUID()}`
  localStorage.setItem(probe, '1')
  localStorage.removeItem(probe)
  if (initialized) {
    synchronize()
    return
  }
  marker = readMarker()
  initialized = true
  if (marker.startsWith('pending:')) status = 'logout-pending'
  window.addEventListener('storage', (event) => {
    if (event.key === markerKey || event.key === null) synchronize()
  })
  window.addEventListener('focus', synchronize)
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(lockName)
    channel.onmessage = synchronize
  }
}
function mark(kind: 'identity' | 'anonymous' | 'pending') {
  const next = `${kind}:${crypto.randomUUID()}`
  localStorage.setItem(markerKey, next)
  marker = next
  channel?.postMessage({ changed: true })
}
export function getAuthUser() {
  synchronize()
  return credentials?.user ?? null
}
export function getAccessToken() {
  synchronize()
  return credentials?.accessToken ?? null
}
export function getAuthSession() {
  synchronize()
  return sessionGeneration
}
export function clearAuth() {
  dropIdentity('anonymous')
}
export function setCredentials(next: Credentials, preserveSession = false) {
  const previous = credentials?.user.id
  generation++
  if (!preserveSession) sessionGeneration++
  if (previous && previous !== next.user.id) void purgeUserCaches(previous).catch(() => {})
  credentials = next
  expiresAt = Date.now() + next.expiresIn * 1000
  refreshNeedsConfirmation = false
  status = 'authenticated'
  errorMessage = ''
  notify()
}
async function coordinated<T>(action: () => Promise<T>, allowChange = false): Promise<T> {
  initialize()
  const started = sessionGeneration
  const expected = marker
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    return await navigator.locks.request(lockName, { signal: controller.signal }, async () => {
      clearTimeout(timer)
      synchronize()
      if (
        !allowChange &&
        (sessionGeneration !== started || marker !== expected || status === 'logout-pending')
      )
        throw new AuthError('登录状态已变化')
      return action()
    })
  } catch (error) {
    if (controller.signal.aborted) throw new AuthError('等待登录会话协调超时，请重试')
    throw error
  } finally {
    clearTimeout(timer)
  }
}
async function authRequest<T>(
  path: string,
  body: object,
  method = 'POST',
  token?: string,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Web-Editor-Request': 'browser',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => ({}))
      const code =
        payload && typeof payload === 'object' && 'code' in payload
          ? String(payload.code)
          : undefined
      const rawRetry = response.headers.get('Retry-After')
      const retry = rawRetry ? Number(rawRetry) : NaN
      throw new AuthError(
        code === 'AUTH_REFRESH_OUTCOME_UNKNOWN'
          ? '刷新结果不确定。可手动重试或重新登录；重试可能使会话失效。'
          : (getResponseMessage(payload) ?? `请求失败（${response.status}）`),
        response.status,
        code,
        Number.isInteger(retry) && retry >= 0 ? retry : undefined,
      )
    }
    if (response.status === 204) return undefined as T
    return ((await response.json()) as { data: T }).data
  } catch (error) {
    if (controller.signal.aborted)
      throw new AuthError(
        '请求超时，结果不确定。可手动重试或重新登录；重试可能使会话失效。',
        0,
        'AUTH_REFRESH_OUTCOME_UNKNOWN',
      )
    throw error
  } finally {
    clearTimeout(timer)
  }
}
function validate(next: Credentials) {
  if (
    !next ||
    typeof next.accessToken !== 'string' ||
    !next.accessToken ||
    !Number.isFinite(next.expiresIn) ||
    next.expiresIn <= 0 ||
    !next.user ||
    !Number.isSafeInteger(next.user.id) ||
    next.user.id <= 0 ||
    typeof next.user.username !== 'string' ||
    typeof next.user.displayName !== 'string'
  )
    throw new AuthError('登录响应格式无效', 0, 'AUTH_REFRESH_OUTCOME_UNKNOWN')
  return { user: next.user, accessToken: next.accessToken, expiresIn: next.expiresIn }
}
export async function register(
  username: string,
  email: string,
  password: string,
  displayName?: string,
) {
  return authRequest<User>('/api/auth/register', {
    username,
    email: email || null,
    password,
    displayName,
  })
}
export async function login(loginName: string, password: string) {
  return coordinated(async () => {
    const next = validate(
      await authRequest<Credentials>('/api/auth/login', { login: loginName, password }),
    )
    mark('identity')
    setCredentials(next)
    return next
  }, true)
}
async function refreshUnlocked() {
  if (Date.now() < retryAt)
    throw new AuthError(
      '请求过于频繁，请稍后重试',
      429,
      'AUTH_RATE_LIMITED',
      Math.ceil((retryAt - Date.now()) / 1000),
    )
  const started = generation
  const expected = marker
  try {
    const next = validate(await authRequest<Credentials>('/api/auth/refresh', {}))
    synchronize()
    if (generation !== started || marker !== expected) throw new AuthError('登录状态已变化')
    const identityChanged = credentials !== null && credentials.user.id !== next.user.id
    if (identityChanged) mark('identity')
    setCredentials(next, !identityChanged)
    retryAt = 0
    return next
  } catch (error) {
    if (generation === started && error instanceof AuthError && error.status === 401) {
      mark('anonymous')
      dropIdentity('anonymous')
    } else if (generation === started) {
      if (error instanceof AuthError && error.retryAfter !== undefined)
        retryAt = Date.now() + error.retryAfter * 1000
      refreshNeedsConfirmation =
        !(error instanceof AuthError) || error.code === 'AUTH_REFRESH_OUTCOME_UNKNOWN'
      errorMessage = error instanceof Error ? error.message : '登录服务暂时不可用'
      if (!(error instanceof AuthError))
        errorMessage = '网络异常，刷新结果不确定。可手动重试或重新登录；重试可能使会话失效。'
      notify()
    }
    throw error
  }
}
export async function refreshCredentials(manual = false) {
  if (refreshNeedsConfirmation && !manual)
    throw new AuthError(errorMessage, 0, 'AUTH_REFRESH_OUTCOME_UNKNOWN')
  if (!refreshPromise) {
    const pending = coordinated(refreshUnlocked).finally(() => {
      if (refreshPromise === pending) refreshPromise = null
    })
    refreshPromise = pending
  }
  return refreshPromise
}
export async function restoreSession(retry = false) {
  if (restorePromise) return restorePromise
  if (!retry && status !== 'restoring') return
  const started = generation
  const pending = (async () => {
    try {
      initialize()
      if (status === 'logout-pending') {
        notify()
        return
      }
      status = 'restoring'
      errorMessage = ''
      notify()
      await refreshCredentials(retry)
    } catch (error) {
      if (generation !== started || status === 'logout-pending') return
      status = 'restore-error'
      errorMessage = error instanceof Error ? error.message : '恢复登录失败，请重试'
      notify()
    }
  })().finally(() => {
    if (restorePromise === pending) restorePromise = null
  })
  restorePromise = pending
  return pending
}
export async function accessToken() {
  if (!getAuthUser()) return null
  if (Date.now() >= expiresAt - 30_000) await refreshCredentials()
  return getAccessToken()
}
export async function invalidateSession() {
  return coordinated(async () => {
    mark('anonymous')
    dropIdentity('anonymous')
  })
}
export async function logout() {
  return coordinated(async () => {
    mark('pending')
    dropIdentity('logout-pending')
    errorMessage = '服务端退出尚未确认'
    try {
      const result = await authRequest<{ outcome: 'revoked' | 'local-only' }>(
        '/api/auth/logout',
        {},
      )
      if (!result || !['revoked', 'local-only'].includes(result.outcome))
        throw new AuthError('退出响应格式无效')
      mark('anonymous')
      status = 'anonymous'
      errorMessage =
        result.outcome === 'revoked'
          ? ''
          : '已在本机退出，其他设备状态未确认。可重新登录后再次退出其他设备。'
      notify()
      return result
    } catch (error) {
      errorMessage = `服务端退出尚未确认：${error instanceof Error ? error.message : '请求失败'}`
      notify()
      throw error
    }
  }, true)
}
export async function changePassword(currentPassword: string, newPassword: string) {
  return coordinated(async () => {
    if (!credentials) throw new AuthError('需要登录')
    if (refreshNeedsConfirmation)
      throw new AuthError(errorMessage, 0, 'AUTH_REFRESH_OUTCOME_UNKNOWN')
    if (Date.now() >= expiresAt - 30_000) await refreshUnlocked()
    const expected = marker
    await authRequest(
      '/api/auth/password',
      { currentPassword, newPassword },
      'PUT',
      credentials!.accessToken,
    )
    synchronize()
    if (expected !== marker) throw new AuthError('登录状态已变化')
    mark('anonymous')
    dropIdentity('anonymous')
  })
}
