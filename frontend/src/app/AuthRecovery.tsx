import { useSyncExternalStore } from 'react'
import { Button, Spin } from 'antd'
import { Link } from 'react-router-dom'
import { getAuthError, getAuthStatus, logout, restoreSession, subscribeAuth } from '../api/auth'
import { useNotice } from '../ui/useNotice'

export function AuthRecovery() {
  const status = useSyncExternalStore(subscribeAuth, getAuthStatus)
  const error = useSyncExternalStore(subscribeAuth, getAuthError)
  const show = useNotice()
  if (status === 'restoring') {
    return (
      <main className="auth-shell" aria-live="polite">
        <section className="auth-recovery-loading" role="status" aria-label="正在恢复登录">
          <Spin size="large" />
        </section>
      </main>
    )
  }
  return (
    <main className="auth-shell" aria-live="polite">
      <section>
        <h1>{status === 'logout-pending' ? '服务端退出尚未确认' : '恢复登录失败'}</h1>
        <p>{error}</p>
        <>
          <Button
            onClick={() => {
              if (status === 'logout-pending') {
                void logout()
                  .then((result) => {
                    if (result.outcome === 'revoked') show('已退出登录', 'success')
                  })
                  .catch(() => {})
              } else {
                void restoreSession(true)
              }
            }}
          >
            重试
          </Button>
          <Link to="/login">重新登录</Link>
        </>
      </section>
    </main>
  )
}
