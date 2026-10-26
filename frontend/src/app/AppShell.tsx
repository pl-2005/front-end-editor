import {
  CodeOutlined,
  CompassOutlined,
  DownOutlined,
  LogoutOutlined,
  MailOutlined,
  TeamOutlined,
  UpOutlined,
} from '@ant-design/icons'
import { Button, Layout, Menu, Tooltip } from 'antd'
import { useState, useSyncExternalStore } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { getAuthError, logout, refreshCredentials, subscribeAuth } from '../api/auth'
import { useAuthUser } from '../hooks/useAuthUser'
import { useTask } from '../hooks/useTask'
import { useNotice } from '../ui/useNotice'

export function AppShell({ children }: { children: React.ReactNode }) {
  const [topbarCollapsed, setTopbarCollapsed] = useState(false)
  const user = useAuthUser()
  const authError = useSyncExternalStore(subscribeAuth, getAuthError)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const task = useTask()
  const show = useNotice()
  const selected = pathname.startsWith('/teams') ? '/teams' : pathname
  return (
    <Layout className="v2-shell">
      <Layout.Header className={`v2-topbar${topbarCollapsed ? ' v2-topbar-collapsed' : ''}`}>
        <div id="v2-topbar-content" className="v2-topbar-content" hidden={topbarCollapsed}>
          <Link className="v2-brand" to="/teams">
            <CodeOutlined /> <span>WEB EDITOR</span>
          </Link>
          <nav aria-label="主导航">
            <Menu
              mode="horizontal"
              selectedKeys={[selected]}
              items={[
                {
                  key: '/teams',
                  icon: <TeamOutlined />,
                  label: (
                    <Link to="/teams" aria-current={selected === '/teams' ? 'page' : undefined}>
                      我的团队
                    </Link>
                  ),
                },
                {
                  key: '/discover',
                  icon: <CompassOutlined />,
                  label: (
                    <Link
                      to="/discover"
                      aria-current={selected === '/discover' ? 'page' : undefined}
                    >
                      发现团队
                    </Link>
                  ),
                },
                {
                  key: '/invitations',
                  icon: <MailOutlined />,
                  label: (
                    <Link
                      to="/invitations"
                      aria-current={selected === '/invitations' ? 'page' : undefined}
                    >
                      我的邀请
                    </Link>
                  ),
                },
              ]}
            />
          </nav>
          <div className="v2-account">
            <span>{user?.displayName}</span>
            <Tooltip title="退出当前用户">
              <Button
                danger
                icon={<LogoutOutlined />}
                htmlType="button"
                aria-label="退出当前用户"
                loading={task.busy}
                disabled={task.busy}
                onClick={() =>
                  void task.run(async () => {
                    const result = await logout()
                    if (result.outcome === 'revoked') show('已退出登录', 'success')
                    navigate('/login', { replace: true })
                  })
                }
              />
            </Tooltip>
          </div>
        </div>
        <Tooltip title={topbarCollapsed ? '展开顶部栏' : '折叠顶部栏'}>
          <Button
            className="v2-topbar-toggle"
            type="text"
            size="small"
            htmlType="button"
            icon={topbarCollapsed ? <DownOutlined /> : <UpOutlined />}
            aria-label={topbarCollapsed ? '展开顶部栏' : '折叠顶部栏'}
            aria-expanded={!topbarCollapsed}
            aria-controls="v2-topbar-content"
            onClick={() => setTopbarCollapsed((value) => !value)}
          />
        </Tooltip>
      </Layout.Header>
      <Layout.Content className="v2-content">
        {user && authError && (
          <div role="alert">
            {authError}{' '}
            <Button
              onClick={() => {
                void refreshCredentials(true).catch(() => {})
              }}
            >
              重试登录会话
            </Button>
            <Link to="/login" state={{ reauthenticate: true }}>
              重新登录
            </Link>
          </div>
        )}
        {children}
      </Layout.Content>
    </Layout>
  )
}
