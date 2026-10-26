import { useLayoutEffect, useRef } from 'react'
import { SandpackConsole } from '@codesandbox/sandpack-react'
import { ClearOutlined } from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
import { RestartPreviewButton } from './RestartPreviewButton'

/** 默认展示页面日志；Sandpack 的 Node 环境默认选中服务端日志，且未提供初始标签属性。 */
export function PreviewConsole({ onRestart }: { onRestart?: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const consoleRef = useRef<{ reset: () => void }>(null)

  useLayoutEffect(() => {
    const clientTab = Array.from(host.current?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.trim() === 'Client',
    )
    clientTab?.click()
  }, [])

  return (
    <div ref={host} style={{ height: '100%' }}>
      <SandpackConsole
        ref={consoleRef}
        resetOnPreviewRestart
        showRestartButton={!onRestart}
        showResetConsoleButton={false}
        actionsChildren={
          <>
            {onRestart ? <RestartPreviewButton onRestart={onRestart} /> : null}
            <Tooltip title="清空控制台">
              <Button
                className="sp-button"
                type="text"
                size="small"
                shape="circle"
                htmlType="button"
                icon={<ClearOutlined />}
                aria-label="清空控制台"
                onClick={() => consoleRef.current?.reset()}
              />
            </Tooltip>
          </>
        }
      />
    </div>
  )
}
