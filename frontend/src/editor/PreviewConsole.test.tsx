import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PreviewConsole } from './PreviewConsole'

vi.mock('@codesandbox/sandpack-react', () => ({
  SandpackConsole: () => {
    const [tab, setTab] = useState('server')
    return <div>
      <button onClick={() => setTab('server')}>Server</button>
      <button onClick={() => setTab('client')}>Client</button>
      <pre>{tab === 'client' ? '1' : 'Vite server ready'}</pre>
    </div>
  },
}))

describe('PreviewConsole', () => {
  it('shows browser output initially and after reopening, while keeping server logs accessible', () => {
    const view = render(<PreviewConsole />)
    expect(screen.getByText('1')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Server' }))
    expect(screen.getByText('Vite server ready')).toBeDefined()
    view.unmount()
    render(<PreviewConsole />)
    expect(screen.getByText('1')).toBeDefined()
  })
})
