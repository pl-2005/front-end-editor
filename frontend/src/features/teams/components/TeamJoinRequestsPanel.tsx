import { Button, Card } from 'antd'
import type { JoinRequest } from '../../../types/team'
export function TeamJoinRequestsPanel({
  requests,
  busy,
  onDecide,
}: {
  requests: JoinRequest[]
  busy: boolean
  onDecide: (requestId: number, decision: 'approve' | 'reject') => void
}) {
  return (
    <Card className="v2-panel">
      <h3>加入申请</h3>
      <ul className="v2-list">
        {requests.map((request) => (
          <li key={request.id}>
            <span>@{request.username}</span>
            <span className="v2-actions">
              <Button
                htmlType="button"
                disabled={busy}
                onClick={() => onDecide(request.id, 'approve')}
              >
                批准
              </Button>
              <Button
                danger
                htmlType="button"
                disabled={busy}
                onClick={() => onDecide(request.id, 'reject')}
              >
                拒绝
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {!requests.length ? <p>暂无待审批申请。</p> : null}
    </Card>
  )
}
