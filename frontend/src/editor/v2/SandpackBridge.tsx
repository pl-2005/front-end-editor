import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { SandpackPreview, SandpackProvider, useSandpack } from '@codesandbox/sandpack-react'
import { PreviewConsole } from '../PreviewConsole'
import { RestartPreviewButton } from '../RestartPreviewButton'
import type { CollaborationSession } from '../../collaboration/session'
import type { ProjectFiles } from '../../types/project'
import { previewProjection } from './projection'
import { useFeedback } from '../../ui/useNotice'
/** Sandpack runs code at its own remote origin; disallow parent navigation and referrer disclosure. */
function PreviewBoundary({ children }: { children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = container.current!
    const protect = () =>
      root.querySelectorAll('iframe').forEach((frame) => {
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
        frame.referrerPolicy = 'no-referrer'
      })
    protect()
    const observer = new MutationObserver(protect)
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={container} className="v2-preview-boundary">
      {children}
    </div>
  )
}
function Projection({
  session,
  entry,
  initialFiles,
  onRestart,
}: {
  session: CollaborationSession
  entry: string
  initialFiles: ProjectFiles
  onRestart: () => void
}) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot)
  const { sandpack, listen, dispatch } = useSandpack()
  const runtime = useRef(sandpack)
  const listener = useRef(listen)
  const send = useRef(dispatch)
  useEffect(() => {
    runtime.current = sandpack
    listener.current = listen
    send.current = dispatch
  }, [sandpack, listen, dispatch])
  const [error, setError] = useState('')
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined,
      deadline: ReturnType<typeof setTimeout> | undefined,
      stopped = false
    let refresh: ReturnType<typeof setTimeout> | undefined,
      needsRecovery = false
    const flush = (replay = false) => {
      clearTimeout(debounce)
      clearTimeout(deadline)
      debounce = undefined
      deadline = undefined
      if (stopped) return
      try {
        const next = previewProjection(session),
          current = runtime.current
        for (const path of Object.keys(current.files))
          if (!Object.hasOwn(next.files, path)) current.deleteFile(path, false)
        const changed: ProjectFiles = Object.fromEntries(
          Object.entries(next.files).filter(([path, f]) => {
            // During startup Sandpack may accept state changes without delivering
            // them. Compare the ready replay with the actual startup snapshot.
            const value = replay ? initialFiles[path] : current.files[path]
            return !value || (typeof value === 'string' ? value : value.code) !== f.code
          }),
        )
        if (Object.keys(changed).length) current.updateFile(changed)
        // Vite's HTML error response can lose its HMR connection. Only recover
        // that case; normal HTML edits already reload through Vite.
        if (needsRecovery && Object.hasOwn(changed, entry)) {
          clearTimeout(refresh)
          refresh = setTimeout(() => {
            if (stopped) return
            needsRecovery = false
            send.current({ type: 'refresh' })
          }, 750)
        }
        setError('')
      } catch {
        setError('文档校验失败，预览已暂停')
      }
    }
    const schedule = () => {
      clearTimeout(refresh)
      clearTimeout(debounce)
      debounce = setTimeout(flush, 300)
      deadline ??= setTimeout(flush, 1000)
    }
    // Sandpack drops updates made while a client is initializing. Reapply the
    // latest projection once ready, never a captured older document snapshot.
    let readyTask: ReturnType<typeof setTimeout> | undefined,
      initialized = false
    const unsubscribe = listener.current((message) => {
      if (
        message.type === 'stdout' &&
        typeof message.payload.data === 'string' &&
        /Unable to parse HTML/i.test(message.payload.data) &&
        message.payload.data.includes(entry)
      ) {
        needsRecovery = true
      }
      if (message.type === 'done' && !initialized) {
        initialized = true
        clearTimeout(readyTask)
        readyTask = setTimeout(() => flush(true), 0)
      }
    })
    session.doc.on('update', schedule)
    flush()
    return () => {
      stopped = true
      clearTimeout(debounce)
      clearTimeout(deadline)
      clearTimeout(readyTask)
      clearTimeout(refresh)
      unsubscribe()
      session.doc.off('update', schedule)
    }
  }, [session, entry, initialFiles])
  useFeedback({
    error,
    notice:
      !state.synced && ['offline', 'reconnecting'].includes(state.connection)
        ? '本地未同步 · 预览读取本地文件；首次启动需要运行依赖可用。'
        : '',
  })
  return (
    <div className="v2-preview-pane">
      <SandpackPreview
        startRoute={entry === '/index.html' ? '/' : entry}
        showOpenInCodeSandbox={false}
        showRefreshButton
        showRestartButton={false}
        actionsChildren={<RestartPreviewButton onRestart={onRestart} />}
      />
      <details className="v2-console">
        <summary>控制台</summary>
        <PreviewConsole onRestart={onRestart} />
      </details>
    </div>
  )
}
export function SandpackBridge({
  session,
  entry,
  structureKey,
}: {
  session: CollaborationSession
  entry: string
  structureKey: string
}) {
  const [runtimeGeneration, setRuntimeGeneration] = useState(0)
  const restart = useCallback(() => setRuntimeGeneration((generation) => generation + 1), [])
  const initial = useMemo(
    () => ({ ...previewProjection(session), entry, structureKey, runtimeGeneration }),
    [session, entry, structureKey, runtimeGeneration],
  )
  const customSetup = useMemo(() => ({ entry }), [entry])
  return (
    <SandpackProvider
      key={`${session.identity.projectId}:${session.identity.epoch}:${entry}:${structureKey}:${runtimeGeneration}`}
      template="vite"
      files={initial.files}
      customSetup={customSetup}
      options={{ autorun: true, recompileMode: 'immediate' }}
      theme="light"
    >
      <PreviewBoundary>
        <Projection
          session={session}
          entry={entry}
          initialFiles={initial.files}
          onRestart={restart}
        />
      </PreviewBoundary>
    </SandpackProvider>
  )
}
