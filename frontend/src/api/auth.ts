import type { Credentials, User } from '../types/auth'
import { purgeUserCaches } from '../collaboration/offline'
import { getResponseMessage } from './responseMessage'

let credentials: Credentials | null = null
let expiresAt = 0
let refreshPromise: Promise<Credentials> | null = null
let generation = 0
let sessionGeneration = 0
const listeners = new Set<() => void>()

/**
 * 通知认证状态订阅者重新读取内存会话。
 */
function notify() {
  listeners.forEach((listener) => listener())
}
/**
 * 登记认证状态监听器，返回取消订阅函数。
 *
 * @param listener 状态或读取监听器
 * @returns 用于取消当前订阅的函数
 */
export function subscribeAuth(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
/**
 * 返回内存会话中的用户资料，未登录时为 null。
 */
export function getAuthUser() {
  return credentials?.user ?? null
}
/**
 * 直接读取内存访问令牌，不触发刷新。
 */
export function getAccessToken() {
  return credentials?.accessToken ?? null
}
/**
 * 返回登录会话代次，用于识别退出或切换账号后的过期响应。
 */
export function getAuthSession() {
  return sessionGeneration
}
/**
 * 清除内存凭据及刷新任务，递增状态代次并通知订阅者。
 */
export function clearAuth() {
  const userId = credentials?.user.id
  generation++
  sessionGeneration++
  credentials = null
  expiresAt = 0
  refreshPromise = null
  notify()
  if (userId) void purgeUserCaches(userId).catch(() => {})
}
/**
 * 保存内存凭据并计算到期时间；刷新时可保留会话代次，最后通知订阅者。
 *
 * @param next 新的认证凭据
 * @param preserveSession 是否保留登录会话代次，用于令牌刷新
 */
export function setCredentials(next: Credentials, preserveSession = false) {
  generation++
  if (!preserveSession) sessionGeneration++
  credentials = next
  expiresAt = Date.now() + next.expiresIn * 1000
  notify()
}

/**
 * 发送不携带 Cookie 的认证 POST 请求，返回响应 data；失败时抛出服务端消息。
 *
 * @param path 目标路径
 * @param body 请求体
 */
async function authRequest<T>(path: string, body: object): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => ({}))
    throw new Error(getResponseMessage(payload) ?? `请求失败（${response.status}）`)
  }
  return ((await response.json()) as { data: T }).data
}
/**
 * 提交注册资料并返回用户信息，注册成功后仍需登录。
 *
 * @param username 用户名
 * @param email 邮箱
 * @param password 密码明文，仅用于校验或编码
 * @param displayName 显示名称
 */
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
/**
 * 取得登录凭据并请求 /me 验证用户身份，成功后写入内存会话；验证失败清除会话。
 *
 * @param loginName 登录用户名或邮箱
 * @param password 密码明文，仅用于校验或编码
 */
export async function login(loginName: string, password: string) {
  const next = await authRequest<Credentials>('/api/auth/login', { login: loginName, password })
  try {
    const response = await fetch('/api/auth/me', {
      credentials: 'omit',
      headers: { Authorization: `Bearer ${next.accessToken}` },
    })
    if (!response.ok) throw new Error('登录状态校验失败')
    const user = ((await response.json()) as { data: User }).data
    setCredentials({ ...next, user })
  } catch (error) {
    clearAuth()
    throw error
  }
  return next
}
/**
 * 复用同一个刷新 Promise 处理并发请求；状态代次已变化时丢弃刷新结果，避免恢复旧会话。
 * @returns 新凭据；并发调用共享同一刷新操作
 */
export async function refreshCredentials() {
  if (!credentials) throw new Error('需要登录')
  if (!refreshPromise) {
    const startedAt = generation
    const currentRefreshToken = credentials.refreshToken
    const pending = authRequest<Credentials>('/api/auth/refresh', {
      refreshToken: currentRefreshToken,
    })
      .then((next) => {
        if (generation !== startedAt) throw new Error('登录状态已变化')
        setCredentials(next, true)
        return next
      })
      .catch((error) => {
        if (generation === startedAt) clearAuth()
        throw error
      })
      .finally(() => {
        if (refreshPromise === pending) refreshPromise = null
      })
    refreshPromise = pending
  }
  return refreshPromise
}
/**
 * 返回可用访问令牌，距过期不足三十秒时先刷新；未登录返回 null。
 * @returns 可用访问令牌，未登录时为 null
 */
export async function accessToken() {
  if (!credentials) return null
  if (Date.now() >= expiresAt - 30_000) await refreshCredentials()
  return credentials?.accessToken ?? null
}
/**
 * 请求撤销服务端会话，无论请求是否成功均清除本地认证状态。
 */
export async function logout() {
  try {
    const token = await accessToken()
    if (token)
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'omit',
        headers: { Authorization: `Bearer ${token}` },
      })
  } finally {
    clearAuth()
  }
}
/**
 * 携带访问令牌修改密码，成功后清除本地会话以要求重新登录。
 *
 * @param currentPassword 当前密码
 * @param newPassword 新密码
 */
export async function changePassword(currentPassword: string, newPassword: string) {
  const token = await accessToken()
  if (!token) throw new Error('需要登录')
  const response = await fetch('/api/auth/password', {
    method: 'PUT',
    credentials: 'omit',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  })
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => ({}))
    throw new Error(getResponseMessage(payload) ?? `请求失败（${response.status}）`)
  }
  clearAuth()
}
