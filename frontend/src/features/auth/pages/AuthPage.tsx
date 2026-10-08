import { CodeOutlined, TeamOutlined } from '@ant-design/icons'
import { Button, Card, Input } from 'antd'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSyncExternalStore } from 'react'
import {
  getAuthError,
  getAuthStatus,
  login,
  logout,
  register,
  subscribeAuth,
} from '../../../api/auth'
import { safeReturnTo } from '../../../api/returnTo'
import { useTask } from '../../../hooks/useTask'
import { useNotice } from '../../../ui/useNotice'

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const navigate = useNavigate()
  const location = useLocation()
  const status = useSyncExternalStore(subscribeAuth, getAuthStatus)
  const authError = useSyncExternalStore(subscribeAuth, getAuthError)
  const task = useTask()
  const show = useNotice()
  const [passwordVisible, setPasswordVisible] = useState(false)
  return (
    <main className="auth-shell">
      <div className="auth-intro">
        <span className="auth-logo">
          <CodeOutlined /> WEB EDITOR
        </span>
        <h1>
          一起编写，
          <br />
          即刻呈现。
        </h1>
        <p>
          从一个想法开始，与你的团队共同构建。
          <br />
          实时协作编辑，让每次修改都触手可见。
        </p>
        <div className="auth-feature">
          <TeamOutlined /> 团队协作 <span>·</span> 实时预览 <span>·</span> 自动保存
        </div>
      </div>
      <Card className="auth-card">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const name = String(form.get('login') ?? '').trim()
            const password = String(form.get('password') ?? '')
            void task.run(async () => {
              if (mode === 'register') {
                await register(name, String(form.get('email') ?? '').trim(), password)
                navigate('/login', { replace: true })
              } else {
                await login(name, password)
                navigate(safeReturnTo(location.state?.returnTo), { replace: true })
              }
            })
          }}
        >
          <span className="auth-eyebrow">你的创作空间</span>
          {authError && <p role="status">{authError}</p>}
          {status === 'logout-pending' && (
            <Button
              onClick={() => {
                void logout()
                  .then((result) => {
                    if (result.outcome === 'revoked') show('已退出登录', 'success')
                  })
                  .catch(() => {})
              }}
            >
              重试退出
            </Button>
          )}
          <h2>{mode === 'login' ? '登录' : '注册账号'}</h2>
          <p className="auth-description">
            {mode === 'login' ? '欢迎回来，继续你的团队项目。' : '创建账号，开始与团队共同创作。'}
          </p>
          <label>
            用户名{mode === 'login' ? '或邮箱' : ''}
            <Input name="login" required autoComplete="username" />
          </label>
          {mode === 'register' ? (
            <label>
              邮箱（可选）
              <Input name="email" type="email" autoComplete="email" />
            </label>
          ) : null}
          <div className="auth-password-field">
            <label htmlFor={`${mode}-password`}>密码</label>
            <div className="auth-password-input">
              <Input
                id={`${mode}-password`}
                name="password"
                type={mode === 'login' && passwordVisible ? 'text' : 'password'}
                required
                minLength={10}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
              {mode === 'login' ? (
                <Button
                  className="auth-password-toggle"
                  htmlType="button"
                  aria-label={passwordVisible ? '隐藏密码' : '显示密码'}
                  aria-controls={`${mode}-password`}
                  aria-pressed={passwordVisible}
                  title={passwordVisible ? '隐藏密码' : '显示密码'}
                  onClick={() => setPasswordVisible((value) => !value)}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                    {passwordVisible ? null : <path d="m3 3 18 18" />}
                  </svg>
                </Button>
              ) : null}
            </div>
          </div>
          <Button type="primary" htmlType="submit" loading={task.busy} disabled={task.busy} block>
            {mode === 'login' ? '登录' : '注册'}
          </Button>
          <Button
            block
            href={mode === 'login' ? '/register' : '/login'}
            onClick={(event) => {
              event.preventDefault()
              navigate(mode === 'login' ? '/register' : '/login')
            }}
          >
            {mode === 'login' ? '创建账号' : '前往登录'}
          </Button>
        </form>
      </Card>
    </main>
  )
}
