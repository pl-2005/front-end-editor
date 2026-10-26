import { useImperativeHandle, useState, type ReactNode, type Ref } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PreviewConsole } from './PreviewConsole'

const reset = vi.hoisted(() => vi.fn())

vi.mock('@codesandbox/sandpack-react', () => ({
  SandpackConsole: ({
    ref,
    actionsChildren,
  }: {
    ref: Ref<{ reset: () => void }>
    actionsChildren: ReactNode
  }) => {
    const [tab, setTab] = useState('server')
    useImperativeHandle(ref, () => ({ reset }))
    return (
      <div>
        <button onClick={() => setTab('server')}>Server</button>
        <button onClick={() => setTab('client')}>Client</button>
        <pre>{tab === 'client' ? '1' : 'Vite server ready'}</pre>
        {actionsChildren}
      </div>
    )
  },
}))

describe('PreviewConsole', () => {
  it('shows browser output initially and after reopening, while keeping server logs accessible', () => {
    const view = render(<PreviewConsole />)
    expect(screen.getByText('1')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '清空控制台' }))
    expect(reset).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Server' }))
    expect(screen.getByText('Vite server ready')).toBeDefined()
    view.unmount()
    render(<PreviewConsole />)
    expect(screen.getByText('1')).toBeDefined()
  })
})
