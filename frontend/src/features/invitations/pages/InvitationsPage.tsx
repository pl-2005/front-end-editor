import { Button, Card, Empty, Spin } from 'antd'
import { useNavigate } from 'react-router-dom'
import * as teams from '../../../api/teams'
import { AppShell } from '../../../app/AppShell'
import { RouteBreadcrumb } from '../../../app/RouteBreadcrumb'
import { useTask } from '../../../hooks/useTask'
import { useMyInvitations } from '../hooks/useMyInvitations'

export function InvitationsPage() {
  const navigate = useNavigate()
  const task = useTask()
  const { items, setItems, loaded } = useMyInvitations()
  return (
    <AppShell>
      <section className="v2-section">
        <div className="v2-heading">
          <div>
            <RouteBreadcrumb>加入团队</RouteBreadcrumb>
            <h1>我的邀请</h1>
          </div>
        </div>

        {!loaded ? (
          <Spin description="正在加载邀请…">
            <div className="v2-loading" />
          </Spin>
        ) : !items.length ? (
          <Empty description="暂无待处理邀请。" />
        ) : (
          <div className="v2-cards">
            {items.map((invitation) => (
              <Card className="v2-card" key={invitation.id}>
                <h2>{invitation.teamName}</h2>
                <p>邀请你加入团队 · 有效期至 {new Date(invitation.expiresAt).toLocaleString()}</p>
                <div className="v2-actions">
                  <Button
                    color="green"
                    variant="solid"
                    htmlType="button"
                    disabled={task.busy}
                    onClick={() =>
                      void task.run(async () => {
                        const team = await teams.acceptInvitation(invitation.id)
                        navigate(`/teams/${team.id}`)
                      })
                    }
                  >
                    接受
                  </Button>
                  <Button
                    danger
                    htmlType="button"
                    disabled={task.busy}
                    onClick={() =>
                      void task.run(async () => {
                        await teams.rejectInvitation(invitation.id)
                        setItems((current) => current.filter((item) => item.id !== invitation.id))
                      }, '已拒绝邀请。')
                    }
                  >
                    拒绝
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  )
}
