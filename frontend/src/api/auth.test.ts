import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { safeReturnTo } from './returnTo'

const user = { id: 1, username: 'test', email: null, displayName: 'Test', avatarColor: '#6366F1' }
const next = { user, accessToken: 'access', expiresIn: 600 }
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 })
let auth: typeof import('./auth')
beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  auth = await import('./auth')
})
afterEach(() => {
  auth.clearAuth()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('browser sessions', () => {
  it('rejects browsers without Web Locks without sending requests', async () => {
    vi.stubGlobal('navigator', {})
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await auth.restoreSession()
    expect(auth.getAuthStatus()).toBe('restore-error')
    expect(auth.getAuthError()).toContain('不支持安全会话协调')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects unavailable coordination storage without sending requests', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Denied')
    })
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await auth.restoreSession()
    expect(auth.getAuthStatus()).toBe('restore-error')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('bounds lock waits without stealing a held lock', async () => {
    vi.useFakeTimers()
    vi.spyOn(navigator.locks, 'request').mockImplementation(
      (_name, options) =>
        new Promise((_resolve, reject) => {
          ;(options as LockOptions).signal!.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          )
        }),
    )
    const pending = expect(auth.refreshCredentials()).rejects.toThrow('等待登录会话协调超时')
    await vi.advanceTimersByTimeAsync(15_001)
    await pending
  })
  it('bounds response parsing and requires confirmation after timeout', async () => {
    vi.useFakeTimers()
    auth.setCredentials(next)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, init: RequestInit) => ({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            )
          }),
      })),
    )
    const pending = expect(auth.refreshCredentials()).rejects.toMatchObject({
      code: 'AUTH_REFRESH_OUTCOME_UNKNOWN',
    })
    await vi.advanceTimersByTimeAsync(15_001)
    await pending
    expect(auth.getAuthUser()).toEqual(user)
    await expect(auth.refreshCredentials()).rejects.toMatchObject({
      code: 'AUTH_REFRESH_OUTCOME_UNKNOWN',
    })
  })
  it('honors Retry-After before resending refresh', async () => {
    vi.useFakeTimers()
    auth.setCredentials(next)
    const fetcher = vi.fn(
      async () => new Response('{}', { status: 429, headers: { 'Retry-After': '7' } }),
    )
    vi.stubGlobal('fetch', fetcher)
    await expect(auth.refreshCredentials()).rejects.toMatchObject({ retryAfter: 7 })
    await expect(auth.refreshCredentials()).rejects.toMatchObject({ status: 429 })
    expect(fetcher).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(7001)
    fetcher.mockImplementation(async () => ok(next))
    await auth.refreshCredentials()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('deduplicates startup restore and keeps JWT out of storage', async () => {
    const fetcher = vi.fn(async (_path: string, init: RequestInit) => {
      expect(init.credentials).toBe('same-origin')
      expect(init.body).toBe('{}')
      expect(new Headers(init.headers).get('X-Web-Editor-Request')).toBe('browser')
      return ok(next)
    })
    vi.stubGlobal('fetch', fetcher)
    await Promise.all([auth.restoreSession(), auth.restoreSession()])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(auth.getAuthStatus()).toBe('authenticated')
    expect(JSON.stringify(localStorage)).not.toContain('access')
  })
  it('classifies startup 401 as anonymous', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    )
    await auth.restoreSession()
    expect(auth.getAuthStatus()).toBe('anonymous')
  })
  it.each([429, 503, 403, 400])(
    'keeps runtime identity and generation on HTTP %s',
    async (status) => {
      auth.setCredentials(next)
      const generation = auth.getAuthSession()
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}', { status })),
      )
      await expect(auth.refreshCredentials()).rejects.toMatchObject({ status })
      expect(auth.getAuthUser()).toEqual(user)
      expect(auth.getAuthSession()).toBe(generation)
      expect(auth.getAuthStatus()).toBe('authenticated')
    },
  )
  it('shows startup errors and supports explicit retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 503 })),
    )
    await auth.restoreSession()
    expect(auth.getAuthStatus()).toBe('restore-error')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok(next)),
    )
    await auth.restoreSession(true)
    expect(auth.getAuthUser()).toEqual(user)
  })
  it('does not automatically resend an uncertain refresh', async () => {
    auth.setCredentials(next)
    const fetcher = vi.fn(
      async () => new Response('{"code":"AUTH_REFRESH_OUTCOME_UNKNOWN"}', { status: 503 }),
    )
    vi.stubGlobal('fetch', fetcher)
    await expect(auth.refreshCredentials()).rejects.toMatchObject({
      code: 'AUTH_REFRESH_OUTCOME_UNKNOWN',
    })
    await expect(auth.refreshCredentials()).rejects.toMatchObject({
      code: 'AUTH_REFRESH_OUTCOME_UNKNOWN',
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    fetcher.mockImplementation(async () => ok(next))
    await auth.refreshCredentials(true)
    expect(auth.getAuthUser()).toEqual(user)
  })
  it('retains logout pending across reload and only confirms the returned outcome', async () => {
    auth.setCredentials(next)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline')
      }),
    )
    await expect(auth.logout()).rejects.toThrow('offline')
    expect(auth.getAuthUser()).toBeNull()
    expect(auth.getAuthStatus()).toBe('logout-pending')
    vi.resetModules()
    auth = await import('./auth')
    const fetcher = vi.fn(async () => ok({ outcome: 'local-only' }))
    vi.stubGlobal('fetch', fetcher)
    await auth.restoreSession()
    expect(fetcher).not.toHaveBeenCalled()
    await auth.logout()
    expect(auth.getAuthStatus()).toBe('anonymous')
    expect(auth.getAuthError()).toContain('其他设备状态未确认')
  })
  it('refreshes expired access within the password lock without nesting', async () => {
    auth.setCredentials({ ...next, expiresIn: 0 })
    const fetcher = vi.fn(async (path: string) =>
      path.endsWith('/refresh') ? ok(next) : new Response(null, { status: 204 }),
    )
    vi.stubGlobal('fetch', fetcher)
    await auth.changePassword('current', 'replacement')
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      '/api/auth/refresh',
      '/api/auth/password',
    ])
    expect(auth.getAuthUser()).toBeNull()
  })
  it('uses the login response directly without /me', async () => {
    const fetcher = vi.fn(async () => ok(next))
    vi.stubGlobal('fetch', fetcher)
    await auth.login('test', 'password')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(auth.getAuthUser()).toEqual(user)
  })
  it('discards a response from before an identity switch', async () => {
    auth.setCredentials(next)
    let finish!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve
          }),
      ),
    )
    const pending = auth.refreshCredentials()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    auth.setCredentials({ ...next, user: { ...user, id: 2 } })
    finish(ok(next))
    await expect(pending).rejects.toThrow('登录状态已变化')
    expect(auth.getAuthUser()?.id).toBe(2)
  })
  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/login',
    '/\n/evil.example',
  ])('rejects unsafe return URL %s', (value) => {
    expect(safeReturnTo(value)).toBe('/teams')
  })
  it('preserves local path, query and hash', () => {
    expect(safeReturnTo('/teams/1/projects/2?tab=code#file')).toBe(
      '/teams/1/projects/2?tab=code#file',
    )
  })
})
