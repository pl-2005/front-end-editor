import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import type { TeamProjectDetails } from '../../types/collaboration'
import { fileCommands, readDocument } from '../../collaboration/document'
import { CollaborationSession, isDurable, type ConnectionState } from '../../collaboration/session'
import { MonacoWorkspace } from './MonacoWorkspace'
import { SandpackBridge } from './SandpackBridge'

const CONNECTION_LABELS: Record<ConnectionState, string> = { connecting: '正在连接', syncing: '正在同步', online: '在线', offline: '离线 · 本地未同步', reconnecting: '正在重连 · 本地未同步', forbidden: '授权失效', failed: '协作失败' }
function ConnectedWorkspace({ session }: { session: CollaborationSession }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot)
  const doc = session.doc
  const [chosenId, setChosenId] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [showFiles, setShowFiles] = useState(true)
  const [showCode, setShowCode] = useState(true)
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
  const commands = useMemo(() => ({
    create: (path: string) => session.mutate(d => fileCommands(d, session.identity, () => true).create(path)),
    rename: (id: string, path: string) => session.mutate(d => fileCommands(d, session.identity, () => true).rename(id, path)),
    remove: (id: string) => session.mutate(d => fileCommands(d, session.identity, () => true).remove(id)),
    setEntry: (id: string) => session.mutate(d => fileCommands(d, session.identity, () => true).setEntry(id)),
  }), [session])
  const activeId = document?.files.some(f => f.id === chosenId) ? chosenId : document?.entryFileId ?? ''
  const entry = document?.files.find(f => f.id === document.entryFileId)?.path ?? '/index.html'
  useEffect(() => { if (activeId && state.connection !== 'forbidden') session.setActiveFile(activeId) }, [session, activeId, state.connection])
  const run = (action: () => void) => { try { action(); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : '文件操作失败') } }
  const saved = isDurable(state)
  const acknowledged = state.localHash && state.localHash === state.persistence?.acceptedHash
  return <section className="v2-workspace" aria-label="项目协作工作区">
    <header className="v2-workspace-status" role="status"><span>{CONNECTION_LABELS[state.connection]} · {state.synced && acknowledged ? 'WebSocket 已同步' : 'WebSocket 未同步'}</span>
      <span>{state.persistence?.status === 'failed' ? '持久化失败，暂停输入' : saved ? `已持久化 · generation ${state.persistence?.generation}` : acknowledged && state.synced ? '已同步，等待持久化' : '等待同步与持久化确认'}</span>
      {state.local ? <span>{({ loading: '正在恢复本地日志', saving: '本地保存中', saved: '已保存在本地', full: '本地日志已满，暂停编辑', failed: '本地保存失败，暂停编辑' })[state.local]}</span> : null}
      <button type="button" disabled={!document || state.connection === 'forbidden'} onClick={() => {
        void session.exportFiles().then(value => {
          const url = URL.createObjectURL(new Blob([value], { type: 'application/json' })), link = window.document.createElement('a')
          link.href = url; link.download = `project-${session.identity.projectId}-local.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
        }).catch(cause => setError(cause instanceof Error ? cause.message : '请恢复网络并验证项目权限后导出'))
      }}>验证权限并导出本地包</button></header>
    <ul className="v2-presence" aria-label="在线成员">{state.members?.map(member => <li key={`${member.userId}:${member.connectionId}`} style={{ borderColor: member.color }}>
      {member.name}{member.clientId === doc.clientID ? '（本标签页）' : ''} · 连接 {member.connectionId.split('/')[0].slice(0, 8)}
      {document?.files.find(f => f.id === member.activeFileId)?.path ? ` · ${document.files.find(f => f.id === member.activeFileId)!.path}` : ''}
    </li>)}</ul>
    {state.recoveries?.map(recovery => <div role="alert" className="v2-recovery" key={recovery.id}>
      <p>{recovery.path} 被远端删除，当前内容已保留。可恢复为新文件或复制内容。</p>
      <button type="button" disabled={!state.writable} onClick={() => {
        const path = window.prompt('恢复文件路径（创建新文件）', recovery.path)
        if (path) run(() => {
          const id = session.mutate(d => {
            const next = fileCommands(d, session.identity, () => true).create(path)
            const content = d.getMap<Y.Map<unknown>>('files').get(next)!.get('content') as Y.Text
            content.insert(0, recovery.code)
            return next
          }); setChosenId(id); session.dismissRecovery(recovery.id)
        })
      }}>恢复为新文件</button>
      <button type="button" onClick={() => { void session.copyRecovery(recovery.id).then(() => setNotice('内容已复制')).catch(cause => setError(cause instanceof Error ? cause.message : '复制失败')) }}>复制当前内容</button>
      <button type="button" onClick={() => session.dismissRecovery(recovery.id)}>放弃保留内容</button>
    </div>)}
    {state.error || error ? <p className="v2-error" role="alert">{state.error || error}</p> : null}
    {notice ? <p className="v2-notice" role="status">{notice}</p> : null}
    {document?.conflicts.length ? <p role="status">同路径冲突已归一化：{document.conflicts.join('；')}</p> : null}
    {document ? <><div className="v2-workspace-toolbar" aria-label="工作区布局"><strong>渲染预览</strong><div className="v2-actions">
      <button type="button" aria-expanded={showFiles} aria-controls="project-files-panel" onClick={() => setShowFiles(value => !value)}>{showFiles ? '收起文件栏' : '展开文件栏'}</button>
      <button type="button" aria-expanded={showCode} aria-controls="project-code-panel" onClick={() => setShowCode(value => !value)}>{showCode ? '收起代码栏' : '展开代码栏'}</button>
      <button type="button" aria-pressed={!showFiles && !showCode} onClick={() => {
        const show = !showFiles && !showCode; setShowFiles(show); setShowCode(show)
      }}>{!showFiles && !showCode ? '返回编辑' : '展示渲染页'}</button>
    </div></div><div className="v2-workspace-grid" data-files-visible={showFiles} data-code-visible={showCode}><aside id="project-files-panel" className="v2-file-panel" hidden={!showFiles}><div className="v2-actions"><strong>文件</strong><button type="button" disabled={!state.writable} onClick={() => {
      const value = window.prompt('文件路径，例如 /scripts/helper.js'); if (value) run(() => setChosenId(commands.create(value)))
    }}>新建文件</button></div><ul aria-label="项目文件">{document.files.map(file => <li key={file.id}>
      <button type="button" className={file.id === activeId ? 'active' : ''} aria-pressed={file.id === activeId} onClick={() => setChosenId(file.id)}>{file.path}{file.id === document.entryFileId ? '（入口）' : ''}</button>
      <div className="v2-file-actions"><button type="button" disabled={!state.writable} aria-label={`重命名 ${file.path}`} onClick={() => {
        const path = window.prompt('新的文件路径', file.path); if (path) run(() => { commands.rename(file.id, path); setNotice('文件路径已更新；源码中的引用需要同步修改。') })
      }}>重命名</button><button type="button" disabled={!state.writable || file.id === document.entryFileId} aria-label={`删除 ${file.path}`} onClick={() => {
        if (window.confirm(`删除 ${file.path}？`)) run(() => commands.remove(file.id))
      }}>删除</button>{file.language === 'html' ? <button type="button" disabled={!state.writable || file.id === document.entryFileId} aria-label={`设为入口 ${file.path}`} onClick={() => run(() => commands.setEntry(file.id))}>设为入口</button> : null}</div>
    </li>)}</ul></aside><div id="project-code-panel" className="v2-code-panel" hidden={!showCode}><MonacoWorkspace session={session} files={document.files} activeId={activeId} writable={state.writable} /></div>
      <SandpackBridge session={session} entry={entry} structureKey={JSON.stringify(document.files.map(f => f.path).sort())} /></div></> : <p>{state.connection === 'failed' ? '协作服务不可用，文档尚未加载。' : state.connection === 'forbidden' ? '项目授权已失效，文档已清除。' : '正在加载协作文档…'}</p>}
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
