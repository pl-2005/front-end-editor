import { useCallback, useState } from 'react'
import { errorMessage } from '../ui/errorMessage'
import { useNotice } from '../ui/useNotice'
export function useTask() {
  const show = useNotice()
  const [busy, setBusy] = useState(false)
  const setError = useCallback(
    (error: string) => {
      if (error) show(error, 'error')
    },
    [show],
  )
  /**
   * 执行异步任务，统一维护忙碌状态、错误提示和可选成功消息。
   *
   * @param task 待执行的异步任务
   * @param success 成功后展示的可选消息
   */
  const run = async (task: () => Promise<void>, success?: string) => {
    setBusy(true)
    try {
      await task()
      if (success) show(success, 'success')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  return { busy, run, setError }
}
