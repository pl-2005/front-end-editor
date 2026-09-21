import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProjectFileTree } from './ProjectFileTree'

describe('ProjectFileTree', () => {
  it('prevents the entry file from being renamed or deleted', () => {
    render(<ProjectFileTree
      files={{ '/index.html': { code: '<h1>Hello</h1>' }, '/index.js': { code: '' } }}
      activeFile="/index.html"
      entryFile="/index.html"
      onOpen={vi.fn()}
      onCreate={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
    />)

    expect((screen.getByTitle('入口文件不能重命名') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTitle('入口文件不能删除') as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders nested directories and delegates file operations with normalized paths', () => {
    const onCreate = vi.fn()
    const onRename = vi.fn()
    const onDelete = vi.fn()
    const prompt = vi.spyOn(window, 'prompt')
    prompt.mockReturnValueOnce('assets/new.css').mockReturnValueOnce('src/main.js')

    render(<ProjectFileTree
      files={{ '/index.html': { code: '' }, '/src/app.js': { code: '' } }}
      activeFile="/index.html"
      entryFile="/index.html"
      onOpen={vi.fn()}
      onCreate={onCreate}
      onRename={onRename}
      onDelete={onDelete}
    />)

    expect(screen.getByText('src')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'app.js' })).toBeTruthy()
    fireEvent.click(screen.getByTitle('新建文件'))
    fireEvent.click(screen.getByTitle('重命名 /src/app.js'))
    fireEvent.click(screen.getByTitle('删除 /src/app.js'))

    expect(onCreate).toHaveBeenCalledWith('/assets/new.css')
    expect(onRename).toHaveBeenCalledWith('/src/app.js', '/src/main.js')
    expect(onDelete).toHaveBeenCalledWith('/src/app.js')
  })
})
