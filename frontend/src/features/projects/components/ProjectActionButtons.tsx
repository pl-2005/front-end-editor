import { CopyOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
import type { ReactNode } from 'react'
export function ProjectActionButtons({
  busy,
  onEdit,
  onCopy,
  onDelete,
  exportAction,
  retryAction,
  size = 'table',
}: {
  busy: boolean
  onEdit: () => void
  onCopy: () => void
  onDelete: () => void
  exportAction?: ReactNode
  retryAction?: ReactNode
  size?: 'table' | 'header'
}) {
  const style = size === 'header' ? { fontSize: 20 } : undefined
  return (
    <>
      <Tooltip title="编辑">
        <Button
          htmlType="button"
          type="text"
          icon={<EditOutlined style={style} />}
          aria-label="编辑"
          disabled={busy}
          onClick={onEdit}
        />
      </Tooltip>
      <Tooltip title="复制项目">
        <Button
          htmlType="button"
          type="text"
          icon={<CopyOutlined style={style} />}
          aria-label="复制项目"
          disabled={busy}
          onClick={onCopy}
        />
      </Tooltip>
      {exportAction}
      <Tooltip title="删除">
        <Button
          danger
          htmlType="button"
          type="text"
          icon={<DeleteOutlined style={style} />}
          aria-label="删除"
          disabled={busy}
          onClick={onDelete}
        />
      </Tooltip>
      {retryAction}
    </>
  )
}
