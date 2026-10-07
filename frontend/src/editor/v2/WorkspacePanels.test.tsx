import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Grid } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspacePanels } from './WorkspacePanels'

const originalResizeObserver = globalThis.ResizeObserver

const panels = {
  files: <input aria-label="文件栏内容" defaultValue="保留内容" />,
  code: <div>代码</div>,
  preview: <div>渲染页</div>,
}
const drag = (separator: HTMLElement, x: number, y = 0) => {
  fireEvent.mouseDown(separator, { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: x, clientY: y })
  fireEvent.mouseUp(window)
}

describe('WorkspacePanels', () => {
  beforeEach(() => {
    // jsdom 不计算布局；提供容器尺寸，其余保留真实 Splitter 和拖动行为。
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(1000)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 1000,
      height: 1000,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    globalThis.ResizeObserver = class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        queueMicrotask(() => this.callback([{ target } as ResizeObserverEntry], this))
      }
      unobserve() {}
      disconnect() {}
    }
  })
  afterEach(() => {
    vi.restoreAllMocks()
    globalThis.ResizeObserver = originalResizeObserver
  })

  it('resizes both boundaries, clamps sizes, and preserves widths and content across hiding', async () => {
    vi.spyOn(Grid, 'useBreakpoint').mockReturnValue({ sm: true, lg: true })
    const { rerender } = render(<WorkspacePanels {...panels} showFiles showCode />)
    const fileInput = screen.getByRole('textbox', { name: '文件栏内容' })
    const [fileBar, codeBar] = screen.getAllByRole('separator')
    await waitFor(() => expect(fileBar.getAttribute('aria-disabled')).toBe('false'))
    drag(fileBar, 100)
    expect(fileBar.getAttribute('aria-valuenow')).toBe('46')
    drag(codeBar, 150)
    expect(codeBar.getAttribute('aria-valuenow')).toBe('65')
    rerender(<WorkspacePanels {...panels} showFiles={false} showCode={false} />)
    expect(
      screen.getAllByRole('separator').every((bar) => bar.getAttribute('aria-disabled') === 'true'),
    ).toBe(true)
    rerender(<WorkspacePanels {...panels} showFiles showCode />)
    expect(screen.getByRole('textbox', { name: '文件栏内容' })).toBe(fileInput)
    expect(fileBar.getAttribute('aria-valuenow')).toBe('46')
    expect(codeBar.getAttribute('aria-valuenow')).toBe('65')
    // 使用新的按下位置，避免组件把连续操作识别成双击。
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000)
    drag(fileBar, 1000)
    expect(fileBar.getAttribute('aria-valuenow')).toBe('70')
  })

  it('supports vertical resizing on narrow screens', async () => {
    vi.spyOn(Grid, 'useBreakpoint').mockReturnValue({ sm: false, lg: false })
    render(<WorkspacePanels {...panels} showFiles showCode />)
    const [fileBar, codeBar] = screen.getAllByRole('separator')
    await waitFor(() => expect(fileBar.getAttribute('aria-disabled')).toBe('false'))
    expect(codeBar.getAttribute('aria-orientation')).toBe('horizontal')
    expect(fileBar.getAttribute('aria-orientation')).toBe('horizontal')
    drag(fileBar, 0, 100)
    expect(fileBar.getAttribute('aria-valuenow')).toBe('46')
  })

  it('moves only the preview below the editor at medium widths without remounting content', async () => {
    const breakpoint = vi.spyOn(Grid, 'useBreakpoint').mockReturnValue({ sm: true, lg: true })
    const { rerender } = render(<WorkspacePanels {...panels} showFiles showCode />)
    const input = screen.getByRole('textbox', { name: '文件栏内容' })
    const [fileBar, previewBar] = screen.getAllByRole('separator')
    await waitFor(() => expect(fileBar.getAttribute('aria-disabled')).toBe('false'))
    expect(previewBar.getAttribute('aria-orientation')).toBe('vertical')
    breakpoint.mockReturnValue({ sm: true, lg: false })
    rerender(<WorkspacePanels {...panels} showFiles showCode />)
    expect(fileBar.getAttribute('aria-orientation')).toBe('vertical')
    expect(previewBar.getAttribute('aria-orientation')).toBe('horizontal')
    expect(screen.getByRole('textbox', { name: '文件栏内容' })).toBe(input)
    drag(previewBar, 0, 100)
    expect(previewBar.getAttribute('aria-valuenow')).toBe('60')
  })
})
