import { Button, Card, Input, Spin } from 'antd'
import type { Invitation } from '../../../types/team'
import { useInviteeSearch } from '../hooks/useInviteeSearch'
export function TeamInvitationsPanel({
  teamId,
  invitations,
  busy,
  onError,
  onIssue,
  onRevoke,
}: {
  teamId: number
  invitations: Invitation[]
  busy: boolean
  onError: (error: string) => void
  onIssue: (userId: number, onIssued: () => void) => void
  onRevoke: (invitationId: number) => void
}) {
  const {
    inviteIdentifier,
    changeIdentifier,
    invitees,
    inviteSearchComplete,
    inviteSearching,
    afterIssue,
  } = useInviteeSearch(teamId, true, onError)
  return (
    <Card className="v2-panel">
      <div className="v2-invite-heading">
        <h3>邀请成员</h3>
        <Input
          aria-label="用户名或邮箱"
          value={inviteIdentifier}
          placeholder="请输入用户名或邮箱"
          allowClear
          maxLength={254}
          suffix={inviteSearching ? <Spin size="small" /> : undefined}
          onChange={(event) => changeIdentifier(event.target.value)}
        />
      </div>
      {inviteSearchComplete ? (
        <div className="v2-invite-results" aria-label="用户搜索结果">
          {invitees.length ? (
            <>
              <p>
                找到 {invitees.length} 位用户，请确认要邀请的账号。
                {invitees.length === 20 ? '最多显示 20 位，请细化关键词。' : ''}
              </p>
              <ul className="v2-list">
                {invitees.map((invitee) => (
                  <li className="v2-invite-result" key={invitee.userId}>
                    <span>
                      已找到：{invitee.displayName}（@{invitee.username}）
                    </span>
                    <Button
                      htmlType="button"
                      disabled={busy}
                      onClick={() => onIssue(invitee.userId, afterIssue(invitee.userId))}
                    >
                      确认发送邀请
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p role="status">没有找到可邀请的用户，请尝试其他关键词。</p>
          )}
        </div>
      ) : null}
      <details className="v2-invitation-records">
        <summary>邀请记录（{invitations.length}）</summary>
        <ul className="v2-list">
          {invitations.map((invitation) => (
            <li key={invitation.id}>
              <span>
                {invitation.username ? `@${invitation.username}` : invitation.email}{' '}
                <small>{invitation.status}</small>
              </span>
              {invitation.status === 'PENDING' ? (
                <Button
                  danger
                  htmlType="button"
                  disabled={busy}
                  onClick={() => onRevoke(invitation.id)}
                >
                  撤销
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {!invitations.length ? <p>暂无邀请记录。</p> : null}
      </details>
    </Card>
  )
}
