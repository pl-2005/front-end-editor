import { Button, Card } from 'antd'
import type { Member } from '../../../types/team'
export function TeamMembersPanel({
  members,
  isOwner,
  busy,
  onTransfer,
  onRemove,
  onLeave,
}: {
  members: Member[]
  isOwner: boolean
  busy: boolean
  onTransfer: (userId: number) => void
  onRemove: (userId: number) => void
  onLeave: () => void
}) {
  return (
    <Card className="v2-panel">
      <h3>成员列表</h3>
      <ul className="v2-list">
        {members.map((member) => (
          <li key={member.userId}>
            <span>
              {member.displayName}{' '}
              <small>
                @{member.username} · {member.role === 'OWNER' ? '所有者' : '成员'}
              </small>
            </span>
            {isOwner && member.role === 'MEMBER' ? (
              <span className="v2-actions">
                <Button htmlType="button" disabled={busy} onClick={() => onTransfer(member.userId)}>
                  转移所有权
                </Button>
                <Button
                  danger
                  htmlType="button"
                  disabled={busy}
                  onClick={() => onRemove(member.userId)}
                >
                  移除
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {!isOwner ? (
        <Button
          danger
          className="v2-danger-button"
          htmlType="button"
          disabled={busy}
          onClick={onLeave}
        >
          退出团队
        </Button>
      ) : null}
    </Card>
  )
}
