import { useLayoutEffect, useRef } from 'react'
import { SandpackConsole } from '@codesandbox/sandpack-react'

/** 默认展示页面日志；Sandpack 的 Node 环境默认选中服务端日志，且未提供初始标签属性。 */
export function PreviewConsole() {
  const host = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const clientTab = Array.from(host.current?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.trim() === 'Client',
    )
    clientTab?.click()
  }, [])

  return (
    <div ref={host} style={{ height: '100%' }}>
      <SandpackConsole resetOnPreviewRestart />
    </div>
  )
}
