import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppTheme } from '../../ui/AppTheme'
import { fixture } from '../../test/collaborationFixture'
import { readDocument } from '../../collaboration/document'
import { WorkspaceFileExplorer } from './WorkspaceFileExplorer'

const documents: ReturnType<typeof fixture>[] = []
function setup(writable = true) {
  const f = fixture()
  documents.push(f)
  const appId = f.commands.create('/src/app.js')
  f.commands.createDirectory('/empty')
  let activeId = 'entry'
  const callbacks = {
    onUpload: vi.fn((files: { path: string; code: string }[]) => {
      const ids = f.commands.importFiles(files)
      activeId = ids[0]
      refresh()
    }),
    onOpen: vi.fn((id: string) => {
      activeId = id
      refresh()
    }),
    onCreate: vi.fn((path: string, kind: 'file' | 'directory') => {
      if (kind === 'directory') f.commands.createDirectory(path)
      else activeId = f.commands.create(path)
      refresh()
    }),
    onRename: vi.fn((from: string, to: string) => {
      f.commands.renamePath(from, to)
      refresh()
    }),
    onDelete: vi.fn((path: string) => {
      const receipt = f.commands.removePath(path)
      refresh()
      return () => {
        f.commands.restore(receipt)
        refresh()
      }
    }),
    onSetEntry: vi.fn((id: string) => {
      f.commands.setEntry(id)
      refresh()
    }),
  }
  const ui = () => {
    const state = readDocument(f.doc, f.identity)
    return (
      <AppTheme>
        <WorkspaceFileExplorer {...state} {...callbacks} activeId={activeId} writable={writable} />
      </AppTheme>
    )
  }
  const view = render(ui())
  function refresh() {
    view.rerender(ui())
  }
  return { f, appId, callbacks, view }
}
async function menu(path: string, action: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: `文件操作 ${path}` }))
  fireEvent.click(await screen.findByRole('menuitem', { name: action }))
}
function enterName(label: string, value: string) {
  const input = screen.getByRole('textbox', { name: label })
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('WorkspaceFileExplorer', () => {
  afterEach(() => {
    documents.splice(0).forEach((f) => f.doc.destroy())
    vi.restoreAllMocks()
  })

  it('uploads multiple files into the selected folder and preserves text without templates', async () => {
    const { f, callbacks } = setup()
    fireEvent.click(screen.getByText('empty'))
    fireEvent.click(screen.getByRole('button', { name: '上传文件' }))
    fireEvent.change(screen.getByLabelText('选择上传文件'), {
      target: { files: [new File(['你好'], 'notes.md'), new File([''], 'blank.html')] },
    })
    await waitFor(() =>
      expect(callbacks.onUpload).toHaveBeenCalledWith([
        { path: '/empty/notes.md', code: '你好' },
        { path: '/empty/blank.html', code: '' },
      ]),
    )
    expect(screen.getByText('已上传 2 个文件')).toBeTruthy()
    expect(
      readDocument(f.doc, f.identity)
        .files.find((file) => file.path === '/empty/blank.html')
        ?.content.toString(),
    ).toBe('')
  })

  it('reports upload conflicts without importing any files and permits retry', async () => {
    const { f } = setup()
    fireEvent.click(screen.getByRole('button', { name: '选择项目根目录' }))
    fireEvent.click(screen.getByRole('button', { name: '上传文件' }))
    const input = screen.getByLabelText('选择上传文件')
    fireEvent.change(input, {
      target: { files: [new File(['new'], 'new.js'), new File(['replace'], 'index.html')] },
    })
    await screen.findByText('该文件路径已存在')
    expect(readDocument(f.doc, f.identity).files).toHaveLength(2)
    fireEvent.change(input, { target: { files: [new File(['ok'], 'new.js')] } })
    await screen.findByText('已上传 1 个文件')
    expect(readDocument(f.doc, f.identity).files).toHaveLength(3)
  })

  it('creates files and empty folders in the selected directory with inline validation and cancellation', async () => {
    const { f, callbacks } = setup()
    fireEvent.click(screen.getByText('src'))
    fireEvent.click(screen.getByRole('button', { name: '新建文件' }))
    enterName('文件名', 'app.js')
    expect(callbacks.onCreate).not.toHaveBeenCalled()
    expect(screen.getAllByText('同名文件或文件夹已存在').length).toBeGreaterThan(0)
    enterName('文件名', 'helper.js')
    expect(callbacks.onCreate).toHaveBeenCalledWith('/src/helper.js', 'file')
    expect(screen.getByText('helper.js')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '选择项目根目录' }))
    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }))
    enterName('文件夹名', 'new-folder')
    expect(readDocument(f.doc, f.identity).directories).toContain('/new-folder')
    fireEvent.click(screen.getByRole('button', { name: '新建文件' }))
    enterName('文件名', '../escape.js')
    expect(callbacks.onCreate).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(screen.getByRole('textbox', { name: '文件名' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: '文件名' })).toBeNull()
  })

  it('renames in place with F2 and supports folder context menus', async () => {
    const { f, callbacks } = setup()
    fireEvent.click(screen.getByText('src'))
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'F2' })
    expect((screen.getByRole('textbox', { name: '文件夹名' }) as HTMLInputElement).value).toBe(
      'src',
    )
    enterName('文件夹名', 'lib')
    expect(callbacks.onRename).toHaveBeenCalledWith('/src', '/lib')
    expect(readDocument(f.doc, f.identity).files.some((file) => file.path === '/lib/app.js')).toBe(
      true,
    )
    fireEvent.contextMenu(screen.getByText('empty'))
    fireEvent.click(await screen.findByRole('menuitem', { name: '新建文件' }))
    enterName('文件名', 'inside.css')
    expect(callbacks.onCreate).toHaveBeenCalledWith('/empty/inside.css', 'file')
  })

  it('confirms subtree deletion with a file count and offers undo', async () => {
    const { f, callbacks } = setup()
    fireEvent.click(screen.getByText('src'))
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'Delete' })
    expect(
      (await screen.findAllByText('删除文件夹 /src 及其中的 1 个文件？删除后可在 15 秒内撤销。'))
        .length,
    ).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledWith('/src'))
    expect(readDocument(f.doc, f.identity).files).toHaveLength(1)
    fireEvent.click(await screen.findByRole('button', { name: '撤销' }))
    expect(readDocument(f.doc, f.identity).files).toHaveLength(2)
    expect(screen.getByText('src')).toBeTruthy()
  })

  it('moves a file to the project root using the target picker', async () => {
    const { f, callbacks } = setup()
    fireEvent.click(screen.getByText('src'))
    await menu('/src/app.js', /^移动到/)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '目标文件夹' }))
    fireEvent.click(await screen.findByText('项目根目录 /'))
    fireEvent.click(screen.getByRole('button', { name: '移动' }))
    expect(callbacks.onRename).toHaveBeenCalledWith('/src/app.js', '/app.js')
    expect(readDocument(f.doc, f.identity).files.some((file) => file.path === '/app.js')).toBe(true)
  })

  it('moves a file by dropping it onto a folder', async () => {
    const { callbacks } = setup()
    fireEvent.click(screen.getByText('src'))
    const source = screen.getByText('app.js').closest('.ant-tree-treenode')!
    const target = screen.getByText('empty').closest('.ant-tree-treenode')!
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 30,
      left: 0,
      right: 200,
      width: 200,
      height: 30,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(), effectAllowed: 'move' }
    fireEvent.dragStart(source, { clientX: 60, clientY: 15, dataTransfer })
    fireEvent.dragEnter(target, { clientX: 60, clientY: 15, dataTransfer })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250))
    })
    fireEvent.dragOver(target, { clientX: 60, clientY: 15, dataTransfer })
    fireEvent.drop(target, { clientX: 60, clientY: 15, dataTransfer })
    expect(callbacks.onRename).toHaveBeenCalledWith('/src/app.js', '/empty/app.js')
  })

  it('disables entry deletion and all mutations while read-only', async () => {
    const { callbacks } = setup(false)
    expect((screen.getByRole('button', { name: '上传文件' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.change(screen.getByLabelText('选择上传文件'), {
      target: { files: [new File(['x'], 'x.js')] },
    })
    expect(callbacks.onUpload).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: '新建文件' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByRole('button', { name: '新建文件夹' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.contextMenu(screen.getByText('index.html'))
    expect(
      (await screen.findByRole('menuitem', { name: /^删除/ })).getAttribute('aria-disabled'),
    ).toBe('true')
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'F2' })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(callbacks.onRename).not.toHaveBeenCalled()
  })
})
