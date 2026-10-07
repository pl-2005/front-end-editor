import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  SandpackCodeEditor,
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
  useSandpack,
  type SandpackFiles,
} from '@codesandbox/sandpack-react'
import { useProjectSave } from '../hooks/useProjectSave'
import type { ProjectDetails, ProjectFiles } from '../types/project'
import { ProjectFileTree } from './ProjectFileTree'
import { RevisionHistory } from './RevisionHistory'
import { newFileContent } from './newFileContent'
import { PreviewConsole } from './PreviewConsole'
import { prepareSandpackFiles, restoreUnchangedRuntimeFiles } from './sandpackRuntime'

interface Props {
  project: ProjectDetails
  files: ProjectFiles
  providerKey: string
  recoveredDraft?: boolean
  recoveryMessage?: string
  onVersionChange: (projectId: number, version: number, stateVersion: number) => void
  onReload: () => void
  onSaveCopy: (name: string, entry: string, files: ProjectFiles) => Promise<void>
}

const DEFAULT_CONSOLE_HEIGHT = 190
const MIN_CONSOLE_HEIGHT = 100
const MIN_EDITOR_HEIGHT = 120

/**
 * 将 Sandpack 的字符串或对象文件统一为项目持久化使用的 code 对象。
 *
 * @param files 文件集合
 */
function toProjectFiles(files: SandpackFiles): ProjectFiles {
  return Object.fromEntries(
    Object.entries(files).map(([path, file]) => [
      path,
      { code: typeof file === 'string' ? file : file.code },
    ]),
  )
}

/**
 * 连接 Sandpack 编辑器、预览、文件操作、自动保存和版本历史，并管理控制台尺寸。
 */
function WorkspaceContents({
  project,
  files: sourceFiles,
  recoveryMessage,
  recoveredDraft,
  onVersionChange,
  onReload,
  onSaveCopy,
}: Omit<Props, 'providerKey'>) {
  const { sandpack } = useSandpack()
  const workspaceRef = useRef<HTMLElement>(null)
  const resizeStartRef = useRef<{ pointerY: number; height: number } | null>(null)
  const [consoleHeight, setConsoleHeight] = useState(DEFAULT_CONSOLE_HEIGHT)
  const [isConsoleOpen, setIsConsoleOpen] = useState(true)
  const [isResizingConsole, setIsResizingConsole] = useState(false)
  const files = useMemo(
    () => restoreUnchangedRuntimeFiles(toProjectFiles(sandpack.files), sourceFiles),
    [sandpack.files, sourceFiles],
  )
  const { status, message, save } = useProjectSave({
    projectId: project.id,
    initialVersion: project.version,
    entry: project.entry,
    files,
    onVersionChange,
    initiallyDirty: recoveredDraft,
  })

  /**
   * 按文件类型创建初始内容并在编辑器中打开，将其加入待保存文件集合。
   *
   * @param path 目标路径
   */
  const createFile = useCallback(
    (path: string) => {
      if (sandpack.files[path]) {
        window.alert('该文件已存在')
        return
      }
      sandpack.addFile(path, newFileContent(path))
      sandpack.openFile(path)
    },
    [sandpack],
  )

  /**
   * 复制原内容到新路径后移除旧路径，再激活新文件。
   *
   * @param from 原文件路径
   * @param to 新文件路径
   */
  const renameFile = useCallback(
    (from: string, to: string) => {
      if (from === to) return
      if (from === project.entry) {
        window.alert('入口文件不能重命名')
        return
      }
      if (sandpack.files[to]) {
        window.alert('目标文件已存在')
        return
      }
      const file = sandpack.files[from]
      if (!file) return
      sandpack.addFile(to, typeof file === 'string' ? file : file.code)
      sandpack.deleteFile(from)
      sandpack.openFile(to)
    },
    [project.entry, sandpack],
  )

  /**
   * 禁止删除入口或最后一个文件，确认后从 Sandpack 文件集合移除指定路径。
   *
   * @param path 目标路径
   */
  const removeFile = useCallback(
    (path: string) => {
      if (path === project.entry) {
        window.alert('入口文件不能删除')
        return
      }
      if (Object.keys(sandpack.files).length === 1) {
        window.alert('项目至少需要保留一个文件')
        return
      }
      if (window.confirm(`确定删除 ${path}？`)) sandpack.deleteFile(path)
    },
    [project.entry, sandpack],
  )

  /**
   * 询问副本名称后提交当前入口及文件，供版本冲突时另存使用。
   */
  const saveCopy = useCallback(async () => {
    const name = window.prompt('副本项目名称', `${project.name} 副本`)?.trim()
    if (name)
      await onSaveCopy(
        name,
        project.entry,
        restoreUnchangedRuntimeFiles(toProjectFiles(sandpack.files), sourceFiles),
      )
  }, [onSaveCopy, project.entry, project.name, sandpack.files, sourceFiles])

  useEffect(() => {
    if (!isResizingConsole) return

    /**
     * 根据指针纵向位移更新控制台高度，并限制在工作区可用范围内。
     *
     * @param event 浏览器输入事件
     */
    const resize = (event: PointerEvent) => {
      const start = resizeStartRef.current
      if (!start) return
      const workspaceHeight =
        workspaceRef.current?.getBoundingClientRect().height || window.innerHeight
      const maximumHeight = Math.max(MIN_CONSOLE_HEIGHT, workspaceHeight - 46 - MIN_EDITOR_HEIGHT)
      setConsoleHeight(
        Math.min(
          maximumHeight,
          Math.max(MIN_CONSOLE_HEIGHT, start.height + start.pointerY - event.clientY),
        ),
      )
    }
    /**
     * 清除拖动起点并结束控制台尺寸调整状态。
     */
    const stopResizing = () => {
      resizeStartRef.current = null
      setIsResizingConsole(false)
    }

    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('pointercancel', stopResizing)
    return () => {
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('pointercancel', stopResizing)
    }
  }, [isResizingConsole])

  /**
   * 记录拖动起点和当前高度，启用控制台尺寸调整。
   *
   * @param event 浏览器输入事件
   */
  const startConsoleResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      resizeStartRef.current = { pointerY: event.clientY, height: consoleHeight }
      setIsResizingConsole(true)
    },
    [consoleHeight],
  )

  const workspaceStyle = {
    '--console-height': isConsoleOpen ? `${consoleHeight}px` : '34px',
  } as CSSProperties

  return (
    <section
      ref={workspaceRef}
      className={`workspace${isResizingConsole ? ' resizing-console' : ''}`}
      style={workspaceStyle}
    >
      <header className="editor-toolbar">
        <div>
          <span className={`status-dot ${status}`} />
          <span>{message}</span>
          {recoveryMessage ? <span className="recovery-note">{recoveryMessage}</span> : null}
        </div>
        <div className="toolbar-actions">
          <RevisionHistory
            projectId={project.id}
            currentVersion={project.version}
            hasUnsavedChanges={status !== 'saved'}
            onRestored={onReload}
          />
          {status === 'conflict' ? (
            <>
              <button type="button" onClick={() => void saveCopy()}>
                另存副本
              </button>
              <button type="button" onClick={onReload}>
                重新加载
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="save-button"
            disabled={status === 'saving'}
            onClick={() => void save()}
          >
            保存 <kbd>Ctrl S</kbd>
          </button>
        </div>
      </header>
      <div className="editor-grid">
        <ProjectFileTree
          files={sandpack.files}
          activeFile={sandpack.activeFile}
          entryFile={project.entry}
          onOpen={sandpack.openFile}
          onCreate={createFile}
          onRename={renameFile}
          onDelete={removeFile}
        />
        <SandpackLayout className="sandpack-layout">
          <SandpackCodeEditor showTabs showLineNumbers wrapContent closableTabs />
          <SandpackPreview showOpenInCodeSandbox={false} showRefreshButton />
        </SandpackLayout>
      </div>
      <div className={`console-panel${isConsoleOpen ? '' : ' collapsed'}`}>
        {isConsoleOpen ? (
          <div
            className="console-resize-handle"
            role="separator"
            aria-label="调整控制台高度"
            aria-orientation="horizontal"
            onPointerDown={startConsoleResize}
          />
        ) : null}
        <div className="panel-heading">
          <span>控制台</span>
          <button
            type="button"
            aria-label={isConsoleOpen ? '关闭控制台' : '打开控制台'}
            title={isConsoleOpen ? '关闭控制台' : '打开控制台'}
            onClick={() => setIsConsoleOpen((open) => !open)}
          >
            {isConsoleOpen ? '×' : '⌃'}
          </button>
        </div>
        {isConsoleOpen ? <PreviewConsole /> : null}
      </div>
    </section>
  )
}

/**
 * 准备临时预览文件并创建 Sandpack Provider；providerKey 改变时重新初始化编辑器会话。
 */
export function EditorWorkspace({
  project,
  files,
  providerKey,
  recoveryMessage,
  recoveredDraft,
  onVersionChange,
  onReload,
  onSaveCopy,
}: Props) {
  const customSetup = useMemo(() => ({ entry: project.entry }), [project.entry])
  const runtimeFiles = useMemo(() => prepareSandpackFiles(files), [files])

  return (
    <SandpackProvider
      key={providerKey}
      template="vite"
      files={runtimeFiles}
      customSetup={customSetup}
      options={{
        activeFile: project.entry,
        visibleFiles: Object.keys(files),
        autorun: true,
        recompileMode: 'delayed',
        recompileDelay: 300,
      }}
      theme="light"
    >
      <WorkspaceContents
        project={project}
        files={files}
        recoveryMessage={recoveryMessage}
        recoveredDraft={recoveredDraft}
        onVersionChange={onVersionChange}
        onReload={onReload}
        onSaveCopy={onSaveCopy}
      />
    </SandpackProvider>
  )
}
