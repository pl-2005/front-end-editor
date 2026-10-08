// Local acceptance only. Per-account cookie jars stay in process memory.
export function createAuthFetch(origin) {
  const cookies = new Map(), tokenAccounts = new Map()
  return async (url, init = {}) => {
    const path = new URL(url).pathname
    if (!path.startsWith('/api/auth/')) return fetch(url, init)
    const headers = new Headers(init.headers)
    const body = init.body ? JSON.parse(init.body) : {}
    const account = path.endsWith('/login') ? body.login : tokenAccounts.get(headers.get('Authorization')?.slice(7))
    headers.set('Origin', origin); headers.set('X-Web-Editor-Request', 'browser')
    headers.set('Content-Type', 'application/json')
    if (account && cookies.has(account)) headers.set('Cookie', cookies.get(account))
    const response = await fetch(url, { ...init, headers, body: JSON.stringify(body) })
    const payload = response.status === 204 ? undefined : await response.clone().json().catch(() => undefined)
    const name = payload?.data?.user?.username ?? account
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith('web_editor_refresh='))
    if (name && cookie) {
      if (/Max-Age=0(?:;|$)/.test(cookie)) cookies.delete(name)
      else cookies.set(name, cookie.split(';')[0])
    }
    if (payload?.data?.accessToken && name) tokenAccounts.set(payload.data.accessToken, name)
    return response
  }
}
