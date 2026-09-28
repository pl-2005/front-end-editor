import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import {
  SandpackCodeEditor, SandpackConsole, SandpackLayout, SandpackPreview, SandpackProvider, useSandpack,
  type SandpackFiles,
} from '@codesandbox/sandpack-react'
import { useProjectSave } from '../hooks/useProjectSave'
import type { ProjectDetails, ProjectFiles } from '../types/project'
import { ProjectFileTree } from './ProjectFileTree'
import { RevisionHistory } from './RevisionHistory'
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

function toProjectFiles(files: SandpackFiles): ProjectFiles {
  return Object.fromEntries(Object.entries(files).map(([path, file]) => [path, { code: typeof file === 'string' ? file : file.code }]))
}

function WorkspaceContents({ project, files: sourceFiles, recoveryMessage, recoveredDraft, onVersionChange, onReload, onSaveCopy }: Omit<Props, 'providerKey'>) {
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
  const { status, message, save } = useProjectSave({ projectId: project.id, initialVersion: project.version, entry: project.entry, files, onVersionChange, initiallyDirty: recoveredDraft })

  const createFile = useCallback((path: string) => {
    if (sandpack.files[path]) { window.alert('该文件已存在'); return }
    sandpack.addFile(path, '')
    sandpack.openFile(path)
  }, [sandpack])

  const renameFile = useCallback((from: string, to: string) => {
    if (from === to) return
    if (from === project.entry) { window.alert('入口文件不能重命名'); return }
    if (sandpack.files[to]) { window.alert('目标文件已存在'); return }
    const file = sandpack.files[from]
    if (!file) return
    sandpack.addFile(to, typeof file === 'string' ? file : file.code)
    sandpack.deleteFile(from)
    sandpack.openFile(to)
  }, [project.entry, sandpack])

  const removeFile = useCallback((path: string) => {
    if (path === project.entry) { window.alert('入口文件不能删除'); return }
    if (Object.keys(sandpack.files).length === 1) { window.alert('项目至少需要保留一个文件'); return }
    if (window.confirm(`确定删除 ${path}？`)) sandpack.deleteFile(path)
  }, [project.entry, sandpack])

  const saveCopy = useCallback(async () => {
    const name = window.prompt('副本项目名称', `${project.name} 副本`)?.trim()
    if (name) await onSaveCopy(name, project.entry,
      restoreUnchangedRuntimeFiles(toProjectFiles(sandpack.files), sourceFiles))
  }, [onSaveCopy, project.entry, project.name, sandpack.files, sourceFiles])

  useEffect(() => {
    if (!isResizingConsole) return

    const resize = (event: PointerEvent) => {
      const start = resizeStartRef.current
      if (!start) return
      const workspaceHeight = workspaceRef.current?.getBoundingClientRect().height || window.innerHeight
      const maximumHeight = Math.max(MIN_CONSOLE_HEIGHT, workspaceHeight - 46 - MIN_EDITOR_HEIGHT)
      setConsoleHeight(Math.min(maximumHeight, Math.max(MIN_CONSOLE_HEIGHT, start.height + start.pointerY - event.clientY)))
    }
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

  const startConsoleResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    resizeStartRef.current = { pointerY: event.clientY, height: consoleHeight }
    setIsResizingConsole(true)
  }, [consoleHeight])

  const workspaceStyle = {
    '--console-height': isConsoleOpen ? `${consoleHeight}px` : '34px',
  } as CSSProperties

  return <section ref={workspaceRef} className={`workspace${isResizingConsole ? ' resizing-console' : ''}`} style={workspaceStyle}>
    <header className="editor-toolbar">
      <div><span className={`status-dot ${status}`} /><span>{message}</span>{recoveryMessage ? <span className="recovery-note">{recoveryMessage}</span> : null}</div>
      <div className="toolbar-actions">
        <RevisionHistory projectId={project.id} currentVersion={project.version}
          hasUnsavedChanges={status !== 'saved'} onRestored={onReload} />
        {status === 'conflict' ? <><button type="button" onClick={() => void saveCopy()}>另存副本</button><button type="button" onClick={onReload}>重新加载</button></> : null}
        <button type="button" className="save-button" disabled={status === 'saving'} onClick={() => void save()}>保存 <kbd>Ctrl S</kbd></button>
      </div>
    </header>
    <div className="editor-grid">
      <ProjectFileTree files={sandpack.files} activeFile={sandpack.activeFile} entryFile={project.entry} onOpen={sandpack.openFile} onCreate={createFile} onRename={renameFile} onDelete={removeFile} />
      <SandpackLayout className="sandpack-layout">
        <SandpackCodeEditor showTabs showLineNumbers wrapContent closableTabs />
        <SandpackPreview showOpenInCodeSandbox={false} showRefreshButton />
      </SandpackLayout>
    </div>
    <div className={`console-panel${isConsoleOpen ? '' : ' collapsed'}`}>
      {isConsoleOpen ? <div className="console-resize-handle" role="separator" aria-label="调整控制台高度" aria-orientation="horizontal" onPointerDown={startConsoleResize} /> : null}
      <div className="panel-heading">
        <span>控制台</span>
        <button type="button" aria-label={isConsoleOpen ? '关闭控制台' : '打开控制台'} title={isConsoleOpen ? '关闭控制台' : '打开控制台'} onClick={() => setIsConsoleOpen((open) => !open)}>
          {isConsoleOpen ? '×' : '⌃'}
        </button>
      </div>
      {isConsoleOpen ? <SandpackConsole resetOnPreviewRestart /> : null}
    </div>
  </section>
}

export function EditorWorkspace({ project, files, providerKey, recoveryMessage, recoveredDraft, onVersionChange, onReload, onSaveCopy }: Props) {
  const customSetup = useMemo(() => ({ entry: project.entry }), [project.entry])
  const runtimeFiles = useMemo(() => prepareSandpackFiles(files), [files])

  return <SandpackProvider
    key={providerKey}
    template="vite"
    files={runtimeFiles}
    customSetup={customSetup}
    options={{ activeFile: project.entry, visibleFiles: Object.keys(files), autorun: true, recompileMode: 'delayed', recompileDelay: 300 }}
    theme="dark"
  >
    <WorkspaceContents project={project} files={files} recoveryMessage={recoveryMessage} recoveredDraft={recoveredDraft} onVersionChange={onVersionChange} onReload={onReload} onSaveCopy={onSaveCopy} />
  </SandpackProvider>
}
