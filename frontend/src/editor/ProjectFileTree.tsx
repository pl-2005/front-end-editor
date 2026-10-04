import { useMemo } from 'react'
import type { SandpackFiles } from '@codesandbox/sandpack-react'

interface TreeNode {
  name: string
  path?: string
  children?: TreeNode[]
}

interface Props {
  files: SandpackFiles
  activeFile: string
  entryFile: string
  onOpen: (path: string) => void
  onCreate: (path: string) => void
  onRename: (from: string, to: string) => void
  onDelete: (path: string) => void
}

/**
 * 去除输入首尾空白，将反斜杠转换为 /，并补齐路径开头的 /。
 *
 * @param value 待规范化或处理的文本
 */
const normalizePath = (value: string) => {
  const path = value.trim().replaceAll('\\', '/')
  return path.startsWith('/') ? path : `/${path}`
}

/**
 * 将绝对文件路径列表按目录分组，生成排序后的树节点。
 *
 * @param paths 文件路径列表
 */
function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', children: [] }
  for (const path of paths.sort()) {
    const parts = path.slice(1).split('/')
    let parent = root
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1
      if (isFile) {
        parent.children?.push({ name: part, path })
        return
      }
      let directory = parent.children?.find((node) => !node.path && node.name === part)
      if (!directory) {
        directory = { name: part, children: [] }
        parent.children?.push(directory)
      }
      parent = directory
    })
  }
  /**
   * 递归排序目录和文件：目录优先，同类节点按名称排列。
   *
   * @param nodes 树节点集合
   */
  const sortNodes = (nodes: TreeNode[]): TreeNode[] => nodes
    .sort((left, right) => Number(Boolean(left.path)) - Number(Boolean(right.path)) || left.name.localeCompare(right.name))
    .map((node) => node.children ? { ...node, children: sortNodes(node.children) } : node)
  return sortNodes(root.children ?? [])
}

/**
 * 渲染目录树、文件打开及新增、重命名、删除操作，限制入口文件变更。
 */
export function ProjectFileTree({ files, activeFile, entryFile, onOpen, onCreate, onRename, onDelete }: Props) {
  const tree = useMemo(() => buildTree(Object.keys(files)), [files])
  /**
   * 询问并规范化新文件路径，再通知工作区创建；是否重复由工作区检查。
   */
  const createFile = () => {
    const value = window.prompt('输入文件路径，例如 /about.html')
    if (value) onCreate(normalizePath(value))
  }

  /**
   * 递归渲染目录和文件节点，并为文件绑定打开及管理操作。
   *
   * @param nodes 树节点集合
   */
  const renderNodes = (nodes: TreeNode[]) => nodes.map((node) => node.children
    ? <li className="directory-node" key={`directory-${node.name}`} role="treeitem">
      <details open>
        <summary><span className="folder-icon" />{node.name}</summary>
        <ul role="group">{renderNodes(node.children)}</ul>
      </details>
    </li>
    : <li className={`file-row ${node.path === activeFile ? 'active' : ''}`} key={node.path} role="treeitem">
      <button className="file-name" type="button" onClick={() => onOpen(node.path!)}><span className="file-dot" />{node.name}</button>
      <div className="file-actions">
        <button type="button" disabled={node.path === entryFile} title={node.path === entryFile ? '入口文件不能重命名' : `重命名 ${node.path}`} onClick={() => {
          const next = window.prompt('新的文件路径', node.path)
          if (next) onRename(node.path!, normalizePath(next))
        }}>✎</button>
        <button type="button" disabled={node.path === entryFile} title={node.path === entryFile ? '入口文件不能删除' : `删除 ${node.path}`} onClick={() => onDelete(node.path!)}>×</button>
      </div>
    </li>)

  return <aside className="file-panel">
    <div className="panel-heading"><span>文件</span><button type="button" title="新建文件" onClick={createFile}>+</button></div>
    <nav aria-label="项目文件"><ul className="file-tree" role="tree">{renderNodes(tree)}</ul></nav>
  </aside>
}
