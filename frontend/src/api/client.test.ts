import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearAuth, getAuthUser, setCredentials } from './auth'
import { request } from './client'

const user = { id: 1, username: 'test', email: null, displayName: 'Test', avatarColor: '#6366F1' }
const envelope = (data: unknown) =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

describe('API client authentication', () => {
  it('does not retry the original business request if Cookie refresh reveals another identity', async () => {
    setCredentials({ user, accessToken: 'old', expiresIn: 600 })
    const fetcher = vi.fn(async (path: string) =>
      path === '/api/auth/refresh'
        ? envelope({ user: { ...user, id: 2 }, accessToken: 'new', expiresIn: 600 })
        : new Response('{}', { status: 401 }),
    )
    vi.stubGlobal('fetch', fetcher)
    await expect(request('/api/private')).rejects.toThrow('登录状态已变化')
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/private')).toHaveLength(1)
    expect(getAuthUser()?.id).toBe(2)
  })
  it('preserves identity and propagates refresh 503 instead of the original business 401', async () => {
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
    const fetcher = vi.fn(
      async (path: string) =>
        new Response('{}', { status: path === '/api/auth/refresh' ? 503 : 401 }),
    )
    vi.stubGlobal('fetch', fetcher)
    await expect(request('/api/private')).rejects.toMatchObject({ status: 503 })
    expect(getAuthUser()).toEqual(user)
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/private')).toHaveLength(1)
  })
  afterEach(() => {
    clearAuth()
    vi.unstubAllGlobals()
  })

  it('omits credentials and Content-Type on a bodyless GET, while sending Bearer', async () => {
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
    const fetcher = vi.fn((path: string, init: RequestInit) => {
      expect(path).toBe('/api/example')
      expect(init.credentials).toBe('omit')
      return Promise.resolve(envelope({ ok: true }))
    })
    vi.stubGlobal('fetch', fetcher)
    await request('/api/example')
    const init = fetcher.mock.calls[0][1] as RequestInit
    expect(init.credentials).toBe('omit')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer access')
    expect(new Headers(init.headers).has('Content-Type')).toBe(false)
  })

  it('rotates credentials once for concurrent near-expiry requests', async () => {
    setCredentials({ user, accessToken: 'old', expiresIn: 0 })
    const fetcher = vi.fn((path: string, init: RequestInit) => {
      if (path === '/api/auth/refresh')
        return Promise.resolve(envelope({ user, accessToken: 'new', expiresIn: 600 }))
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer new')
      return Promise.resolve(envelope({ ok: true }))
    })
    vi.stubGlobal('fetch', fetcher)
    await Promise.all([request('/api/a'), request('/api/b')])
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/auth/refresh')).toHaveLength(1)
  })

  it('keeps identity on 403 and exposes integer Retry-After on 429', async () => {
    setCredentials({ user, accessToken: 'access', expiresIn: 600 })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{"code":"ACCESS_DENIED"}', { status: 403 }))),
    )
    await expect(request('/api/denied')).rejects.toMatchObject({
      status: 403,
      code: 'ACCESS_DENIED',
    })
    expect(getAuthUser()).toEqual(user)
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('slow down', { status: 429, headers: { 'Retry-After': '7' } }),
        ),
      ),
    )
    await expect(request('/api/rate')).rejects.toMatchObject({ status: 429, retryAfter: 7 })
    expect(getAuthUser()).toEqual(user)
  })

  it('accepts a 204 response without JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    )
    await expect(request('/api/empty', { method: 'POST' })).resolves.toBeUndefined()
  })

  it('preserves a response message separately from local HTTP fallbacks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ message: '  团队不接受加入申请  ', code: 'ACCESS_DENIED' }),
            { status: 403 },
          ),
        ),
      ),
    )
    await expect(request('/api/example')).rejects.toMatchObject({
      message: '团队不接受加入申请',
      responseMessage: '团队不接受加入申请',
      status: 403,
      code: 'ACCESS_DENIED',
    })
  })

  it.each([{}, { message: '' }, { message: '  ' }, { message: null }, { message: 123 }, null])(
    'uses a local fallback for an invalid response message: %j',
    async (payload) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), { status: 409 }))),
      )
      await expect(request('/api/example')).rejects.toMatchObject({
        message: '请求失败（409）',
        responseMessage: undefined,
      })
    },
  )

  it('does not replay an in-flight request under a newly logged-in account', async () => {
    setCredentials({ user, accessToken: 'old', expiresIn: 600 })
    let finish!: (response: Response) => void
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    vi.stubGlobal('fetch', fetcher)
    const pending = request('/api/private')
    await Promise.resolve()
    await Promise.resolve()
    setCredentials({
      user: { ...user, id: 2 },
      accessToken: 'other',
      expiresIn: 600,
    })
    finish(new Response(null, { status: 401 }))
    await expect(pending).rejects.toThrow('登录状态已变化')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
