import { App } from 'antd'
import { useCallback, useEffect, useRef } from 'react'

/** 业务提示直接调用 Ant Design，全局容器和生命周期由 App 管理。 */
export function useNotice() {
  const { notification } = App.useApp()
  return useCallback(
    (title: string, type: 'success' | 'error' | 'info' = 'info') => {
      if (title)
        notification.open({
          title,
          type,
          role: type === 'error' ? 'alert' : 'status',
          closable: { 'aria-label': '关闭提示' },
        })
    },
    [notification],
  )
}

/** 同一异步状态只提示一次，手动关闭后不因重新渲染重复出现。 */
export function useFeedback({ error, notice }: { error?: string; notice?: string }) {
  const show = useNotice()
  const previous = useRef({ error: '', notice: '' })
  useEffect(() => {
    if (error && error !== previous.current.error) show(error, 'error')
    if (notice && notice !== previous.current.notice) show(notice, 'success')
    previous.current = { error: error ?? '', notice: notice ?? '' }
  }, [error, notice, show])
}
