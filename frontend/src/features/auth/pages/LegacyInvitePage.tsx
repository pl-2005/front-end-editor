import { useState } from 'react'
import { Link } from 'react-router-dom'

export function LegacyInvitePage() {
  useState(() => {
    if (window.location.hash)
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search,
      )
  })
  return (
    <main className="auth-shell">
      <section className="auth-status">
        <h1>旧邀请链接已停用</h1>
        <p>请联系团队所有者重新发送站内邀请，然后登录并在“我的邀请”中处理。</p>
        <Link to="/login">前往登录</Link>
      </section>
    </main>
  )
}
