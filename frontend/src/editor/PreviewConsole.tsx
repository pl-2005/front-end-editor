import { useLayoutEffect, useRef } from 'react'
import { SandpackConsole } from '@codesandbox/sandpack-react'
import { RestartPreviewButton } from './RestartPreviewButton'

/** 默认展示页面日志；Sandpack 的 Node 环境默认选中服务端日志，且未提供初始标签属性。 */
export function PreviewConsole({ onRestart }: { onRestart?: () => void }) {
  const host = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const clientTab = Array.from(host.current?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.trim() === 'Client',
    )
    clientTab?.click()
  }, [])

  return (
    <div ref={host} style={{ height: '100%' }}>
      <SandpackConsole
        resetOnPreviewRestart
        showRestartButton={!onRestart}
        actionsChildren={onRestart ? <RestartPreviewButton onRestart={onRestart} /> : undefined}
      />
    </div>
  )
}
