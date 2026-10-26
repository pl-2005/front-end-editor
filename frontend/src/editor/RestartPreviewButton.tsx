import { RetweetOutlined } from '@ant-design/icons'
import { Button, Tooltip } from 'antd'

export function RestartPreviewButton({ onRestart }: { onRestart: () => void }) {
  return (
    <Tooltip title="重启预览">
      <Button
        className="sp-button preview-restart-button"
        type="text"
        size="small"
        shape="circle"
        icon={<RetweetOutlined />}
        onClick={onRestart}
        aria-label="重启预览"
        htmlType="button"
      />
    </Tooltip>
  )
}
