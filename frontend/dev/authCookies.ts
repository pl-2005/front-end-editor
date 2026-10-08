const refreshCookie = 'web_editor_refresh'

function instanceCookie(port: number) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('Cannot determine the frontend instance port')
  }
  return `${refreshCookie}_${port}`
}

/** 仅转发当前 Vite 实例的 Cookie，并将名称转换为后端使用的固定名称。 */
export function requestCookies(header: string | undefined, port: number) {
  const name = instanceCookie(port)
  const cookies = (header ?? '').split(';').flatMap((part) => {
    const cookie = part.trim()
    if (!cookie) return []
    const key = cookie.slice(0, cookie.indexOf('='))
    if (key === name) return [`${refreshCookie}${cookie.slice(key.length)}`]
    // 忽略旧的共享 Cookie，以及其他前端实例的 Cookie。
    if (key === refreshCookie || key.startsWith(`${refreshCookie}_`)) return []
    return [cookie]
  })
  return cookies.length ? cookies.join('; ') : undefined
}

/** 签发和删除 Cookie 时都转换名称，保留所有安全属性。 */
export function responseCookies(headers: string[] | undefined, port: number) {
  const name = instanceCookie(port)
  return headers?.map((cookie) =>
    cookie.startsWith(`${refreshCookie}=`)
      ? `${name}${cookie.slice(refreshCookie.length)}`
      : cookie,
  )
}
