import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import type { TeamProjectDetails } from '../../types/collaboration'
import { fileCommands, readDocument } from '../../collaboration/document'
import { CollaborationSession, isDurable, type ConnectionState } from '../../collaboration/session'
import { MonacoWorkspace } from './MonacoWorkspace'
import { SandpackBridge } from './SandpackBridge'

const CONNECTION_LABELS: Record<ConnectionState, string> = { connecting: '正在连接', syncing: '正在同步', online: '在线', offline: '离线（暂时只读）', reconnecting: '正在重连', forbidden: '授权失效', failed: '协作失败' }
function ConnectedWorkspace({ session }: { session: CollaborationSession }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot)
  const doc = session.doc
  const [chosenId, setChosenId] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  useEffect(() => {
    if (state.connection === 'forbidden') return
    const files = doc.getMap('files')
    const changed = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
      for (const event of events) if (event instanceof Y.YMapEvent && event.keysChanged.has('path')) {
        const oldPath = event.changes.keys.get('path')?.oldValue, path = event.target.get('path')
        if (typeof oldPath === 'string' && typeof path === 'string' && path !== oldPath && /~[a-f0-9]+(?:-\d+)?\./.test(path)) setNotice(`同路径冲突已归一化：${oldPath} → ${path}`)
      }
    }
    files.observeDeep(changed)
    return () => files.unobserveDeep(changed)
  }, [doc, state.connection])
  const document = useMemo(() => {
    void state.revision // External Y.Doc version invalidates this projection.
    if (state.connection === 'forbidden') return null
    try { return readDocument(session.doc, session.identity) } catch { return null }
  }, [session, state.revision, state.connection])
  const commands = useMemo(() => fileCommands(doc, session.identity, () => session.state.writable), [doc, session])
  const activeId = document?.files.some(f => f.id === chosenId) ? chosenId : document?.entryFileId ?? ''
  const entry = document?.files.find(f => f.id === document.entryFileId)?.path ?? '/index.html'
  const run = (action: () => void) => { try { action(); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : '文件操作失败') } }
  const saved = isDurable(state)
  const acknowledged = state.localHash && state.localHash === state.persistence?.acceptedHash
  return <section className="v2-workspace" aria-label="项目协作工作区">
    <header className="v2-workspace-status" role="status"><span>{CONNECTION_LABELS[state.connection]} · {state.synced && acknowledged ? 'WebSocket 已同步' : 'WebSocket 未同步'}</span>
      <span>{state.persistence?.status === 'failed' ? '持久化失败，暂停输入' : saved ? `已持久化 · generation ${state.persistence?.generation}` : acknowledged ? '已同步，等待持久化' : '等待同步与持久化确认'}</span></header>
    {state.error || error ? <p className="v2-error" role="alert">{state.error || error}</p> : null}
    {notice ? <p className="v2-notice" role="status">{notice}</p> : null}
    {document?.conflicts.length ? <p role="status">同路径冲突已归一化：{document.conflicts.join('；')}</p> : null}
    {document ? <div className="v2-workspace-grid"><aside className="v2-file-panel"><div className="v2-actions"><strong>文件</strong><button type="button" disabled={!state.writable} onClick={() => {
      const value = window.prompt('文件路径，例如 /scripts/helper.js'); if (value) run(() => setChosenId(commands.create(value)))
    }}>新建文件</button></div><ul aria-label="项目文件">{document.files.map(file => <li key={file.id}>
      <button type="button" className={file.id === activeId ? 'active' : ''} aria-pressed={file.id === activeId} onClick={() => setChosenId(file.id)}>{file.path}{file.id === document.entryFileId ? '（入口）' : ''}</button>
      <div className="v2-file-actions"><button type="button" disabled={!state.writable} aria-label={`重命名 ${file.path}`} onClick={() => {
        const path = window.prompt('新的文件路径', file.path); if (path) run(() => { commands.rename(file.id, path); setNotice('文件路径已更新；源码中的引用需要同步修改。') })
      }}>重命名</button><button type="button" disabled={!state.writable || file.id === document.entryFileId} aria-label={`删除 ${file.path}`} onClick={() => {
        if (window.confirm(`删除 ${file.path}？`)) run(() => commands.remove(file.id))
      }}>删除</button>{file.language === 'html' ? <button type="button" disabled={!state.writable || file.id === document.entryFileId} aria-label={`设为入口 ${file.path}`} onClick={() => run(() => commands.setEntry(file.id))}>设为入口</button> : null}</div>
    </li>)}</ul></aside><MonacoWorkspace session={session} files={document.files} activeId={activeId} writable={state.writable} />
      <SandpackBridge session={session} entry={entry} structureKey={JSON.stringify(document.files.map(f => f.path).sort())} /></div> : <p>{state.connection === 'failed' ? '协作服务不可用，文档尚未加载。' : state.connection === 'forbidden' ? '项目授权已失效，文档已清除。' : '正在加载协作文档…'}</p>}
  </section>
}
export default function ProjectWorkspace({ project, userId, teamId }: { project: TeamProjectDetails; userId: number; teamId: number }) {
  const [session, setSession] = useState<CollaborationSession | null>(null)
  const projectId = project.id, epoch = project.collaboration.epoch
  useEffect(() => {
    const next = new CollaborationSession({ projectId, epoch }, userId, teamId)
    let disposed = false
    queueMicrotask(() => { if (!disposed) { setSession(next); void next.connect() } })
    return () => { disposed = true; next.destroy() }
  }, [projectId, epoch, userId, teamId])
  return session ? <ConnectedWorkspace key={`${userId}:${projectId}:${epoch}`} session={session} /> : <p>正在准备协作工作区…</p>
}
