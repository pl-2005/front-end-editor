export function safeReturnTo(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    Array.from(value).some((character) => character === '\\' || character.charCodeAt(0) <= 32)
  )
    return '/teams'
  const url = new URL(value, window.location.origin)
  if (url.origin !== window.location.origin || ['/login', '/register'].includes(url.pathname))
    return '/teams'
  return url.pathname + url.search + url.hash
}
