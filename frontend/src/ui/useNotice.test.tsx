import { act, fireEvent, render as renderUI, screen } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import type { ReactElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { useFeedback, useNotice } from './useNotice'
import { AppTheme } from './AppTheme'

const render = (ui: ReactElement) =>
  renderUI(ui, {
    wrapper: ({ children }) => (
      <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>
    ),
  })

function FeedbackProbe({ error }: { error: string }) {
  useFeedback({ error })
  return null
}

function Trigger() {
  const show = useNotice()
  return <button onClick={() => show('操作成功', 'success')}>触发提示</button>
}

afterEach(() => vi.useRealTimers())

it('automatically closes each notification three seconds after it appears', async () => {
  vi.useFakeTimers()
  render(
    <AppTheme>
      <Trigger />
    </AppTheme>,
  )
  fireEvent.click(screen.getByRole('button', { name: '触发提示' }))
  await act(async () => vi.advanceTimersByTimeAsync(50))
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  fireEvent.click(screen.getByRole('button', { name: '触发提示' }))
  await act(async () => vi.advanceTimersByTimeAsync(50))
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(screen.getAllByRole('status')).toHaveLength(1)
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(screen.queryByRole('status')).toBeNull()
})

it('lets users close a notification without waiting for its timer', () => {
  render(
    <AppTheme>
      <Trigger />
    </AppTheme>,
  )
  fireEvent.click(screen.getByRole('button', { name: '触发提示' }))
  fireEvent.click(screen.getByRole('button', { name: '关闭提示' }))
  expect(screen.queryByRole('status')).toBeNull()
})

it('does not show the same state message again after dismissing it', () => {
  const { rerender } = render(
    <AppTheme>
      <FeedbackProbe error="操作失败" />
    </AppTheme>,
  )
  fireEvent.click(screen.getByRole('button', { name: '关闭提示' }))
  rerender(
    <AppTheme>
      <FeedbackProbe error="操作失败" />
    </AppTheme>,
  )
  expect(screen.queryByRole('alert')).toBeNull()
})
