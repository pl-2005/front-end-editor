import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Serialize test locks, including abortable waiters, like the browser Web Locks API.
let authLock: Promise<unknown> = Promise.resolve()
Object.defineProperty(navigator, 'locks', {
  configurable: true,
  value: {
    request: (_name: string, options: { signal?: AbortSignal }, callback: () => unknown) => {
      const pending = authLock
        .catch(() => {})
        .then(() => {
          if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
          return callback()
        })
      authLock = pending
      return pending
    },
  },
})

// Ant Design 的响应式布局在浏览器中订阅媒体查询。
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})
Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  value: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
})
// jsdom 未实现伪元素样式；弹窗的滚动条测量只需普通元素样式。
const getComputedStyle = window.getComputedStyle.bind(window)
window.getComputedStyle = (element) => getComputedStyle(element)

afterEach(() => cleanup())
