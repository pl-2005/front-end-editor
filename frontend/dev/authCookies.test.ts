import { describe, expect, it } from 'vitest'
import { requestCookies, responseCookies } from './authCookies'

describe('Vite frontend instance cookies', () => {
  it('forwards only the current port cookie and ignores the old shared cookie', () => {
    const cookies =
      'web_editor_refresh=old; web_editor_refresh_5173=alice; web_editor_refresh_5174=bob; preference=dark'
    expect(requestCookies(cookies, 5173)).toBe('web_editor_refresh=alice; preference=dark')
    expect(requestCookies(cookies, 5174)).toBe('web_editor_refresh=bob; preference=dark')
    expect(requestCookies(cookies, 5175)).toBe('preference=dark')
  })
  it('never falls back to a shared or another instance cookie', () => {
    expect(
      requestCookies('web_editor_refresh=old; web_editor_refresh_5173=alice', 5174),
    ).toBeUndefined()
    expect(requestCookies(undefined, 5173)).toBeUndefined()
  })
  it('preserves duplicate instance cookies so the backend still rejects ambiguous credentials', () => {
    expect(requestCookies('web_editor_refresh_5173=one; web_editor_refresh_5173=two', 5173)).toBe(
      'web_editor_refresh=one; web_editor_refresh=two',
    )
  })
  it('namespaces issue and deletion without changing cookie security attributes', () => {
    const properties = '; Path=/api/auth; HttpOnly; Secure; SameSite=Strict'
    expect(
      responseCookies(
        [`web_editor_refresh=token; Max-Age=1800${properties}`, 'preference=dark'],
        5173,
      ),
    ).toEqual([`web_editor_refresh_5173=token; Max-Age=1800${properties}`, 'preference=dark'])
    expect(responseCookies([`web_editor_refresh=; Max-Age=0${properties}`], 5174)).toEqual([
      `web_editor_refresh_5174=; Max-Age=0${properties}`,
    ])
  })
  it.each([0, -1, 65536, NaN, 5173.5])('rejects an invalid frontend port %s', (port) => {
    expect(() => requestCookies(undefined, port)).toThrow('frontend instance port')
  })
})
