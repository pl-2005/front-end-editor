import { ReloadOutlined } from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
export function ProjectInitializationRetry({
  busy,
  onRetry,
  presentation = 'inline',
}: {
  busy: boolean
  onRetry: () => void
  presentation?: 'inline' | 'icon'
}) {
  return presentation === 'icon' ? (
    <Tooltip title="重试项目初始化">
      <Button
        htmlType="button"
        type="text"
        icon={<ReloadOutlined style={{ fontSize: 20 }} />}
        aria-label="重试项目初始化"
        disabled={busy}
        onClick={onRetry}
      />
    </Tooltip>
  ) : (
    <Button htmlType="button" disabled={busy} onClick={onRetry}>
      重试项目初始化
    </Button>
  )
}
