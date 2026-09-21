import { useCallback, useMemo } from 'react'
import {
  SandpackCodeEditor, SandpackConsole, SandpackLayout, SandpackPreview, SandpackProvider, useSandpack,
  type SandpackFiles,
} from '@codesandbox/sandpack-react'
import { useProjectSave } from '../hooks/useProjectSave'
import type { ProjectDetails, ProjectFiles } from '../types/project'
import { ProjectFileTree } from './ProjectFileTree'
import { RevisionHistory } from './RevisionHistory'

interface Props {
  project: ProjectDetails
  files: ProjectFiles
  providerKey: string
  recoveredDraft?: boolean
  recoveryMessage?: string
  onVersionChange: (projectId: number, version: number) => void
  onReload: () => void
  onSaveCopy: (name: string, entry: string, files: ProjectFiles) => Promise<void>
}

function toProjectFiles(files: SandpackFiles): ProjectFiles {
  return Object.fromEntries(Object.entries(files).map(([path, file]) => [path, { code: typeof file === 'string' ? file : file.code }]))
}

function WorkspaceContents({ project, recoveryMessage, recoveredDraft, onVersionChange, onReload, onSaveCopy }: Omit<Props, 'files' | 'providerKey'>) {
  const { sandpack } = useSandpack()
  const files = useMemo(() => toProjectFiles(sandpack.files), [sandpack.files])
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
    if (name) await onSaveCopy(name, project.entry, toProjectFiles(sandpack.files))
  }, [onSaveCopy, project.entry, project.name, sandpack.files])

  return <section className="workspace">
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
    <div className="console-panel"><div className="panel-heading"><span>控制台</span></div><SandpackConsole standalone resetOnPreviewRestart /></div>
  </section>
}

export function EditorWorkspace({ project, files, providerKey, recoveryMessage, recoveredDraft, onVersionChange, onReload, onSaveCopy }: Props) {
  const customSetup = useMemo(() => ({ entry: project.entry }), [project.entry])

  return <SandpackProvider
    key={providerKey}
    template="vanilla"
    files={files}
    customSetup={customSetup}
    options={{ activeFile: project.entry, visibleFiles: Object.keys(files), recompileMode: 'delayed', recompileDelay: 300 }}
    theme="dark"
  >
    <WorkspaceContents project={project} recoveryMessage={recoveryMessage} recoveredDraft={recoveredDraft} onVersionChange={onVersionChange} onReload={onReload} onSaveCopy={onSaveCopy} />
  </SandpackProvider>
}
