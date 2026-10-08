import { EditOutlined } from '@ant-design/icons'
import { Button, Select, Tooltip } from 'antd'
import { Link } from 'react-router-dom'
import { RouteBreadcrumb } from '../../../app/RouteBreadcrumb'
import type { Team } from '../../../types/team'
export function TeamHeader({
  team,
  isOwner,
  busy,
  onEdit,
  onPolicyChange,
}: {
  team: Team | null
  isOwner: boolean
  busy: boolean
  onEdit: () => void
  onPolicyChange: (policy: Team['joinPolicy']) => void
}) {
  return (
    <div className="v2-heading v2-team-detail-heading">
      <div>
        <RouteBreadcrumb parentPath="/teams">
          <Link to="/teams">我的团队</Link> / <span aria-current="page">团队</span>
        </RouteBreadcrumb>
        <div className="v2-team-title">
          <h1>{team?.name ?? '正在加载团队…'}</h1>
          {isOwner && team ? (
            <Tooltip title="编辑">
              <Button
                type="text"
                icon={<EditOutlined style={{ fontSize: 20 }} />}
                aria-label="编辑"
                disabled={busy}
                onClick={onEdit}
              />
            </Tooltip>
          ) : null}
          {isOwner && team ? (
            <div className="v2-team-policy">
              <Select
                aria-label="加入策略"
                value={team.joinPolicy}
                disabled={busy}
                onChange={onPolicyChange}
                options={[
                  { value: 'REQUEST', label: '允许申请' },
                  { value: 'INVITE_ONLY', label: '仅邀请' },
                ]}
              />
            </div>
          ) : null}
        </div>
        <p>{team?.description}</p>
      </div>
    </div>
  )
}
