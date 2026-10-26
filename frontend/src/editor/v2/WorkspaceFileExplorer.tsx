import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Dropdown, Input, Modal, Select, Tooltip, Tree } from 'antd'
import type { MenuProps, TreeDataNode } from 'antd'
import {
  CodeOutlined,
  FileAddOutlined,
  FileOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  MoreOutlined,
  UploadOutlined,
  VerticalAlignMiddleOutlined,
} from '@ant-design/icons'
import type { FileRecord } from '../../collaboration/document'
import { normalizePath } from '../../collaboration/document'
import { isWithin, normalizeDirectoryPath } from '../../../../collaboration/src/directories'
import { useDialogs } from '../../ui/useDialogs'
import { readUploadFiles, UPLOAD_ACCEPT } from '../../collaboration/uploadFiles'

type ProjectFile = Pick<FileRecord, 'id' | 'path' | 'language'>
interface FileNode extends TreeDataNode {
  name: string
  path: string
  file?: ProjectFile
  children?: FileNode[]
}
interface Props {
  files: ProjectFile[]
  directories: string[]
  activeId: string
  entryFileId: string
  writable: boolean
  onOpen: (id: string) => void
  onCreate: (path: string, kind: 'file' | 'directory') => void
  onRename: (from: string, to: string) => void
  onDelete: (path: string) => () => void
  onSetEntry: (id: string) => void
  onUpload: (files: { path: string; code: string }[]) => void
}
interface Edit {
  key: string
  parent: string
  kind: 'file' | 'directory'
  original?: string
  value: string
}
const basename = (path: string) => path.split('/').at(-1) ?? ''
const parentPath = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'
const join = (parent: string, name: string) => `${parent === '/' ? '' : parent}/${name}`
const directoryKey = (path: string) => `directory:${path}`
const ancestors = (path: string) => {
  const parts = path.split('/').filter(Boolean)
  return parts
    .slice(0, -1)
    .map((_, index) => directoryKey(`/${parts.slice(0, index + 1).join('/')}`))
}

function buildTree(files: ProjectFile[], directories: string[], edit: Edit | null) {
  const roots: FileNode[] = [],
    folders = new Map<string, FileNode>()
  const ensure = (path: string): FileNode[] => {
    if (path === '/') return roots
    let folder = folders.get(path)
    if (!folder) {
      folder = {
        key: directoryKey(path),
        name: basename(path),
        path,
        children: [],
        icon: ({ expanded }) =>
          expanded ? (
            <FolderOpenOutlined className="v2-tree-folder-icon" />
          ) : (
            <FolderOutlined className="v2-tree-folder-icon" />
          ),
      }
      folders.set(path, folder)
      ensure(parentPath(path)).push(folder)
    }
    return folder.children!
  }
  directories.forEach(ensure)
  files.forEach((file) =>
    ensure(parentPath(file.path)).push({
      key: file.id,
      name: basename(file.path),
      path: file.path,
      file,
      isLeaf: true,
      icon:
        file.language === 'html' || file.language === 'javascript' ? (
          <CodeOutlined className="v2-tree-code-icon" />
        ) : (
          <FileOutlined className="v2-tree-file-icon" />
        ),
    }),
  )
  if (edit && !edit.original)
    ensure(edit.parent).unshift({
      key: 'draft',
      name: '',
      path: join(edit.parent, ''),
      isLeaf: true,
      icon: edit.kind === 'directory' ? <FolderOutlined /> : <FileOutlined />,
    })
  const sort = (nodes: FileNode[]) => {
    nodes.sort((a, b) =>
      a.key === 'draft'
        ? -1
        : b.key === 'draft'
          ? 1
          : Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name),
    )
    nodes.forEach((node) => {
      if (node.children) sort(node.children)
    })
  }
  sort(roots)
  return { roots, folders: [...folders.keys()] }
}

/** 目录上下文、就地编辑和子树操作共用相同的协作命令入口。 */
export function WorkspaceFileExplorer({
  files,
  directories,
  activeId,
  entryFileId,
  writable,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onSetEntry,
  onUpload,
}: Props) {
  const dialogs = useDialogs()
  const [edit, setEdit] = useState<Edit | null>(null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadNotice, setUploadNotice] = useState('')
  const uploadInput = useRef<HTMLInputElement>(null)
  const uploadDirectory = useRef('/')
  const uploadPending = useRef(false)
  const canUpload = useRef(writable)
  useLayoutEffect(() => {
    canUpload.current = writable
    return () => {
      canUpload.current = false
    }
  }, [writable])
  const [moving, setMoving] = useState<FileNode | null>(null)
  const [destination, setDestination] = useState('/')
  const [undo, setUndo] = useState<{ path: string; restore: () => void } | null>(null)
  const activePath = files.find((file) => file.id === activeId)?.path ?? ''
  const [selection, setSelection] = useState({ activeId, key: activeId })
  const [expansion, setExpansion] = useState({ activePath, keys: ancestors(activePath) })
  const { roots, folders } = useMemo(
    () => buildTree(files, directories, edit),
    [files, directories, edit],
  )
  if (selection.activeId !== activeId) setSelection({ activeId, key: activeId })
  if (expansion.activePath !== activePath)
    setExpansion({ activePath, keys: [...new Set([...expansion.keys, ...ancestors(activePath)])] })
  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => setUndo(null), 15000)
    return () => clearTimeout(timer)
  }, [undo])
  if (!writable && edit) setEdit(null)
  if (!writable && moving) setMoving(null)
  const selectedFile = files.find((file) => file.id === selection.key)
  const selectedDirectory = selection.key.startsWith('directory:') ? selection.key.slice(10) : '/'
  const selectedPath =
    selectedFile?.path ?? (folders.includes(selectedDirectory) ? selectedDirectory : '/')
  const selected: FileNode | null =
    selectedPath === '/'
      ? null
      : { key: selection.key, path: selectedPath, name: basename(selectedPath), file: selectedFile }
  const context = selectedFile ? parentPath(selectedFile.path) : selectedPath
  const entryPath = files.find((file) => file.id === entryFileId)?.path
  const protectedNode = (node: FileNode) =>
    node.file ? node.file.id === entryFileId : !!entryPath && isWithin(entryPath, node.path)
  const report = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : '文件操作失败')
  const reveal = (path: string, from?: string, to?: string) =>
    setExpansion({
      activePath,
      keys: [
        ...new Set([
          ...expansion.keys.map((key) =>
            from && to && isWithin(key.slice(10), from)
              ? directoryKey(to + key.slice(10 + from.length))
              : key,
          ),
          ...ancestors(join(path, 'child')),
        ]),
      ],
    })
  const beginCreate = (kind: Edit['kind'], parent = context) => {
    if (!writable) return
    setError('')
    reveal(parent)
    setEdit({ key: 'draft', parent, kind, value: '' })
  }
  const beginUpload = (parent = context) => {
    if (!writable || uploadPending.current) return
    uploadDirectory.current = parent
    uploadInput.current?.click()
  }
  const upload = async (files: File[]) => {
    if (!files.length || !writable || uploadPending.current) return
    uploadPending.current = true
    setUploading(true)
    setError('')
    setUploadNotice('')
    const parent = uploadDirectory.current
    try {
      const inputs = await readUploadFiles(files, parent)
      if (!canUpload.current) throw new Error('当前连接不可编辑')
      onUpload(inputs)
      reveal(parent)
      setUploadNotice(`已上传 ${files.length} 个文件`)
    } catch (cause) {
      report(cause)
    } finally {
      uploadPending.current = false
      setUploading(false)
    }
  }
  const beginRename = (node: FileNode) => {
    if (!writable) return
    setError('')
    setEdit({
      key: String(node.key),
      parent: parentPath(node.path),
      kind: node.file ? 'file' : 'directory',
      original: node.path,
      value: node.name,
    })
  }
  const editError = (value: Edit) => {
    const name = value.value.trim().normalize('NFKC')
    if (!name) return '请输入名称'
    if (
      /[/\\<>:"|?*]/u.test(name) ||
      [...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      name === '.' ||
      name === '..'
    )
      return '名称不能包含路径分隔符或特殊字符'
    try {
      const path = join(value.parent, name)
      if (value.kind === 'file') normalizePath(path)
      else normalizeDirectoryPath(path)
      if (
        path !== value.original &&
        (files.some((file) => file.path === path) || folders.includes(path))
      )
        return '同名文件或文件夹已存在'
    } catch (cause) {
      return cause instanceof Error ? cause.message : '名称无效'
    }
    return ''
  }
  const commit = () => {
    if (!edit || !writable) return
    const message = editError(edit)
    if (message) {
      setError(message)
      return
    }
    const path = join(edit.parent, edit.value.trim().normalize('NFKC'))
    try {
      if (edit.original) onRename(edit.original, path)
      else onCreate(path, edit.kind)
      if (edit.kind === 'directory') setSelection({ activeId, key: directoryKey(path) })
      setEdit(null)
      setError('')
      reveal(
        edit.kind === 'directory' ? path : edit.parent,
        edit.kind === 'directory' ? edit.original : undefined,
        path,
      )
    } catch (cause) {
      report(cause)
    }
  }
  const remove = async (node: FileNode) => {
    if (!writable || protectedNode(node)) return
    const count = files.filter((file) => isWithin(file.path, node.path)).length
    if (
      !(await dialogs.confirm(
        node.file
          ? `删除 ${node.path}？删除后可在 15 秒内撤销。`
          : `删除文件夹 ${node.path} 及其中的 ${count} 个文件？删除后可在 15 秒内撤销。`,
      ))
    )
      return
    try {
      setUndo({ path: node.path, restore: onDelete(node.path) })
      setError('')
    } catch (cause) {
      report(cause)
    }
  }
  const move = (node: FileNode, parent: string) => {
    if (!writable) return
    try {
      const path = join(parent, node.name)
      onRename(node.path, path)
      if (!node.file) setSelection({ activeId, key: directoryKey(path) })
      reveal(node.file ? parent : path, node.file ? undefined : node.path, path)
      setMoving(null)
      setError('')
    } catch (cause) {
      report(cause)
    }
  }
  const menu = (node: FileNode): MenuProps => ({
    items: [
      ...(!node.file
        ? [
            { key: 'new-file', label: '新建文件', disabled: !writable },
            { key: 'new-directory', label: '新建文件夹', disabled: !writable },
            { key: 'upload', label: '上传文件', disabled: !writable || uploading },
          ]
        : []),
      { key: 'rename', label: '重命名', extra: 'F2', disabled: !writable },
      { key: 'move', label: '移动到…', disabled: !writable },
      {
        key: 'delete',
        label: protectedNode(node) ? (
          <Tooltip title="入口文件及其所在文件夹不能删除">
            <span>删除</span>
          </Tooltip>
        ) : (
          '删除'
        ),
        extra: 'Delete',
        danger: true,
        disabled: !writable || protectedNode(node),
      },
      ...(node.file?.language === 'html'
        ? [{ key: 'entry', label: '设为入口', disabled: !writable || node.file.id === entryFileId }]
        : []),
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation()
      if (key === 'new-file') beginCreate('file', node.path)
      if (key === 'new-directory') beginCreate('directory', node.path)
      if (key === 'upload') beginUpload(node.path)
      if (key === 'rename') beginRename(node)
      if (key === 'delete') void remove(node)
      if (key === 'move') {
        setMoving(node)
        setDestination(parentPath(node.path))
        setError('')
      }
      if (key === 'entry' && node.file) {
        try {
          onSetEntry(node.file.id)
        } catch (cause) {
          report(cause)
        }
      }
    },
  })
  return (
    <div
      className="v2-file-explorer"
      onKeyDown={(event) => {
        if (
          !writable ||
          edit ||
          moving ||
          (event.target instanceof HTMLElement &&
            event.target.closest('input, textarea, [role="dialog"]'))
        )
          return
        if (event.key === 'F2' && selected) {
          event.preventDefault()
          beginRename(selected)
        }
        if (event.key === 'Delete' && selected) {
          event.preventDefault()
          void remove(selected)
        }
      }}
    >
      <div className="v2-file-explorer-heading">
        <Tooltip title="选择项目根目录">
          <Button
            aria-label="选择项目根目录"
            type="text"
            size="small"
            onClick={() => {
              setSelection({ activeId, key: '' })
              setEdit(null)
              setError('')
            }}
          >
            文件
          </Button>
        </Tooltip>
        <Tooltip title={context}>
          <span className="v2-file-context" aria-label="新建位置">
            {context}
          </span>
        </Tooltip>
        <div className="v2-file-heading-actions">
          <input
            ref={uploadInput}
            type="file"
            hidden
            multiple
            accept={UPLOAD_ACCEPT}
            aria-label="选择上传文件"
            disabled={!writable || uploading}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? [])
              event.currentTarget.value = ''
              void upload(files)
            }}
          />
          <Tooltip
            title={`上传文件到 ${context}（HTML/CSS/JS/JSON/TXT/Markdown，UTF-8，单文件最多 1 MiB）`}
          >
            <Button
              type="text"
              size="small"
              icon={<UploadOutlined />}
              aria-label="上传文件"
              loading={uploading}
              disabled={!writable || uploading}
              onClick={() => beginUpload()}
            />
          </Tooltip>
          <Tooltip title={`新建文件（${context}）`}>
            <Button
              type="text"
              size="small"
              icon={<FileAddOutlined />}
              aria-label="新建文件"
              disabled={!writable}
              onClick={() => beginCreate('file')}
            />
          </Tooltip>
          <Tooltip title={`新建文件夹（${context}）`}>
            <Button
              type="text"
              size="small"
              icon={<FolderAddOutlined />}
              aria-label="新建文件夹"
              disabled={!writable}
              onClick={() => beginCreate('directory')}
            />
          </Tooltip>
          <Tooltip title="折叠全部目录">
            <Button
              type="text"
              size="small"
              icon={<VerticalAlignMiddleOutlined />}
              aria-label="折叠全部目录"
              onClick={() => setExpansion({ activePath, keys: [] })}
            />
          </Tooltip>
        </div>
      </div>
      {error ? (
        <Alert type="error" title={error} showIcon closable onClose={() => setError('')} />
      ) : null}
      {uploadNotice ? (
        <Alert
          type="success"
          title={uploadNotice}
          showIcon
          closable
          onClose={() => setUploadNotice('')}
        />
      ) : null}
      {undo ? (
        <Alert
          type="success"
          title={`已删除 ${undo.path}`}
          action={
            <Button
              size="small"
              disabled={!writable}
              onClick={() => {
                try {
                  undo.restore()
                  setUndo(null)
                  setError('')
                } catch (cause) {
                  report(cause)
                }
              }}
            >
              撤销
            </Button>
          }
        />
      ) : null}
      <Tree<FileNode>
        className="v2-project-file-tree"
        aria-label="项目文件"
        blockNode
        showIcon
        virtual={false}
        motion={{ motionAppear: false, motionEnter: false, motionLeave: false }}
        expandAction="click"
        expandedKeys={expansion.keys}
        autoExpandParent={false}
        selectedKeys={[selection.key]}
        onExpand={(keys) => setExpansion({ activePath, keys: keys.map(String) })}
        onSelect={(_, { node }) => {
          if (node.key === 'draft') return
          setSelection({ activeId, key: String(node.key) })
          if (node.file) onOpen(node.file.id)
        }}
        draggable={
          writable && !edit ? { icon: false, nodeDraggable: (node) => node.key !== 'draft' } : false
        }
        allowDrop={({ dropNode, dragNode, dropPosition }) =>
          dropPosition === 0 &&
          !dropNode.file &&
          !isWithin(dropNode.path, dragNode.path) &&
          parentPath(dragNode.path) !== dropNode.path
        }
        onDrop={({ node, dragNode }) => move(dragNode, node.path)}
        treeData={roots}
        titleRender={(node) => {
          if (edit?.key === node.key)
            return (
              <Input
                autoFocus
                maxLength={255}
                placeholder={edit.kind === 'file' ? '例如 helper.js' : '例如 components'}
                aria-label={edit.kind === 'file' ? '文件名' : '文件夹名'}
                value={edit.value}
                status={error || (edit.value && editError(edit)) ? 'error' : undefined}
                onFocus={(event) => {
                  event.stopPropagation()
                  event.target.select()
                }}
                onChange={(event) => {
                  setEdit({ ...edit, value: event.target.value })
                  setError('')
                }}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commit()
                  }
                  if (event.key === 'Escape') {
                    setEdit(null)
                    setError('')
                  }
                }}
              />
            )
          return (
            <Dropdown trigger={['contextMenu']} menu={menu(node)}>
              <span
                className="v2-tree-file-title"
                onContextMenu={() => setSelection({ activeId, key: String(node.key) })}
              >
                <Tooltip title={node.path}>
                  <span className="v2-tree-name">{node.name}</span>
                </Tooltip>
                {node.file?.id === entryFileId ? (
                  <Tooltip title="入口文件">
                    <span className="v2-entry-dot" role="img" aria-label="入口文件" />
                  </Tooltip>
                ) : null}
                <Dropdown trigger={['click']} menu={menu(node)}>
                  <Tooltip title={`文件操作 ${node.path}`}>
                    <Button
                      className="v2-tree-more"
                      type="text"
                      size="small"
                      icon={<MoreOutlined />}
                      aria-label={`文件操作 ${node.path}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelection({ activeId, key: String(node.key) })
                      }}
                    />
                  </Tooltip>
                </Dropdown>
              </span>
            </Dropdown>
          )
        }}
      />
      {edit ? (
        <div className="v2-file-edit-help">
          {edit.value && editError(edit) ? editError(edit) : 'Enter 确认 · Esc 取消'}
        </div>
      ) : null}
      {edit ? (
        <div className="v2-file-edit-actions">
          <Button size="small" type="primary" onClick={commit}>
            确认
          </Button>
          <Button
            size="small"
            onClick={() => {
              setEdit(null)
              setError('')
            }}
          >
            取消
          </Button>
        </div>
      ) : null}
      <Modal
        open={!!moving}
        title={`移动 ${moving?.path ?? ''}`}
        okText="移动"
        cancelText="取消"
        onCancel={() => {
          setMoving(null)
          setError('')
        }}
        onOk={() => {
          if (moving) move(moving, destination)
        }}
      >
        <label>
          目标文件夹
          <Select
            aria-label="目标文件夹"
            className="v2-file-move-target"
            value={destination}
            onChange={setDestination}
            options={[
              '/',
              ...folders.filter((path) => !moving || moving.file || !isWithin(path, moving.path)),
            ].map((value) => ({ value, label: value === '/' ? '项目根目录 /' : value }))}
          />
        </label>
        {error ? <Alert type="error" title={error} /> : null}
      </Modal>
      {dialogs.holder}
    </div>
  )
}
