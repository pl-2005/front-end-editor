import { CodeOutlined, DownOutlined, DownloadOutlined, FileOutlined } from '@ant-design/icons'
import { Button, Popover, Tooltip } from 'antd'
import { CloudServerOutlined, SaveOutlined, WifiOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import * as Y from 'yjs'
import type { TeamProjectDetails } from '../../types/collaboration'
import { fileCommands, readDocument } from '../../collaboration/document'
import { CollaborationSession, isDurable, type ConnectionState } from '../../collaboration/session'
import { MonacoWorkspace } from './MonacoWorkspace'
import { DesignCanvas, type SourceLocation } from '../visual/canvas/DesignCanvas'
import '../visual/canvas/design.css'
import { SandpackBridge } from './SandpackBridge'
import { WorkspaceFileExplorer } from './WorkspaceFileExplorer'
import { WorkspacePanels } from './WorkspacePanels'
import { useFeedback } from '../../ui/useNotice'
import { useDialogs } from '../../ui/useDialogs'

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connecting: '正在连接',
  syncing: '正在同步',
  online: '在线',
  offline: '离线 · 本地未同步',
  reconnecting: '正在重连 · 本地未同步',
  forbidden: '授权失效',
  failed: '协作失败',
}

function ConnectedWorkspace({
  session,
  exportTarget,
}: {
  session: CollaborationSession
  exportTarget: HTMLElement | null
}) {
  const dialogs = useDialogs()
  const state = useSyncExternalStore(session.subscribe, session.snapshot)
  const doc = session.doc
  const [chosenId, setChosenId] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [showCode, setShowCode] = useState(true)
  const [mode, setMode] = useState<'run' | 'design'>('run')
  const [sourceLocation, setSourceLocation] = useState<SourceLocation>()
  const locateSource = useCallback((location: SourceLocation) => {
    setChosenId(location.fileId)
    setShowCode(true)
    setSourceLocation(location)
  }, [])
  const [showFiles, setShowFiles] = useState(true)
  const [showMembers, setShowMembers] = useState(false)
  const members = [...(state.members ?? [])].sort((a, b) => {
    const priority = (member: typeof a) =>
      member.clientId === doc.clientID ? 0 : member.userId === session.userId ? 1 : 2
    return priority(a) - priority(b)
  })
  useEffect(() => {
    if (state.connection === 'forbidden') return
    const files = doc.getMap('files')
    const changed = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
      for (const event of events)
        if (event instanceof Y.YMapEvent && event.keysChanged.has('path')) {
          const oldPath = event.changes.keys.get('path')?.oldValue,
            path = event.target.get('path')
          if (
            typeof oldPath === 'string' &&
            typeof path === 'string' &&
            path !== oldPath &&
            /~[a-f0-9]+(?:-\d+)?\./.test(path)
          )
            setNotice(`同路径冲突已归一化：${oldPath} → ${path}`)
        }
    }
    files.observeDeep(changed)
    return () => files.unobserveDeep(changed)
  }, [doc, state.connection])
  const document = useMemo(() => {
    void state.revision // External Y.Doc version invalidates this projection.
    if (state.connection === 'forbidden') return null
    try {
      return readDocument(session.doc, session.identity)
    } catch {
      return null
    }
  }, [session, state.revision, state.connection])
  const commands = useMemo(
    () => ({
      create: (path: string) =>
        session.mutate((d) => fileCommands(d, session.identity, () => true).create(path)),
      createDirectory: (path: string) =>
        session.mutate((d) => fileCommands(d, session.identity, () => true).createDirectory(path)),
      rename: (from: string, path: string) =>
        session.mutate((d) => fileCommands(d, session.identity, () => true).renamePath(from, path)),
      remove: (path: string) =>
        session.mutate((d) => fileCommands(d, session.identity, () => true).removePath(path)),
      restore: (receipt: ReturnType<ReturnType<typeof fileCommands>['removePath']>) =>
        session.mutate((d) => fileCommands(d, session.identity, () => true).restore(receipt)),
      setEntry: (id: string) =>
        session.mutate((d) => fileCommands(d, session.identity, () => true).setEntry(id)),
    }),
    [session],
  )
  const activeId = document?.files.some((f) => f.id === chosenId)
    ? chosenId
    : (document?.entryFileId ?? '')
  const entry = document?.files.find((f) => f.id === document.entryFileId)?.path ?? '/index.html'
  useEffect(() => {
    if (activeId && state.connection !== 'forbidden') session.setActiveFile(activeId)
  }, [session, activeId, state.connection])
  const run = (action: () => void) => {
    try {
      action()
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '文件操作失败')
    }
  }
  const saved = isDurable(state)
  const acknowledged = state.localHash && state.localHash === state.persistence?.acceptedHash
  useFeedback({ error: state.error || error, notice })
  useFeedback({
    notice: document?.conflicts.length
      ? `同路径冲突已归一化：${document.conflicts.join('；')}`
      : '',
  })
  const statusColors = {
    success: '#22c55e',
    pending: '#faad14',
    error: '#ff4d4f',
    inactive: '#8c8c8c',
  }
  const statusItems = [
    {
      icon: <WifiOutlined />,
      label: `${CONNECTION_LABELS[state.connection]} · ${state.synced && acknowledged ? 'WebSocket 已同步' : 'WebSocket 未同步'}`,
      color:
        state.connection === 'forbidden' || state.connection === 'failed'
          ? statusColors.error
          : state.connection === 'offline'
            ? statusColors.inactive
            : state.connection === 'online' && state.synced && acknowledged
              ? statusColors.success
              : statusColors.pending,
    },
    {
      icon: <CloudServerOutlined />,
      label:
        state.connection === 'forbidden'
          ? '授权失效，无法保存到服务端'
          : state.persistence?.status === 'failed'
            ? '持久化失败，暂停输入'
            : saved
              ? `已持久化 · generation ${state.persistence?.generation}`
              : acknowledged && state.synced
                ? '已同步，等待持久化'
                : '等待同步与持久化确认',
      color:
        state.connection === 'forbidden' || state.persistence?.status === 'failed'
          ? statusColors.error
          : saved
            ? statusColors.success
            : statusColors.pending,
    },
    {
      icon: <SaveOutlined />,
      label: state.local
        ? {
            loading: '正在恢复本地日志',
            saving: '本地保存中',
            saved: '已保存在本地',
            full: '本地日志已满，暂停编辑',
            failed: '本地保存失败，暂停编辑',
          }[state.local]
        : '本地保存尚未就绪',
      color:
        state.local === 'failed' || state.local === 'full'
          ? statusColors.error
          : state.local === 'saved'
            ? statusColors.success
            : state.local
              ? statusColors.pending
              : statusColors.inactive,
    },
  ]
  const status = (
    <div className="v2-workspace-status" role="status">
      {statusItems.map(({ label, color, icon }) => (
        <Tooltip key={label} title={label}>
          <span
            className="v2-workspace-status-icon"
            role="img"
            aria-label={label}
            tabIndex={0}
            style={{ color, fontSize: 20 }}
          >
            {icon}
          </span>
        </Tooltip>
      ))}
    </div>
  )
  return (
    <section className="v2-workspace" aria-label="项目协作工作区">
      {exportTarget &&
        createPortal(
          <Tooltip title="导出项目">
            <Button
              htmlType="button"
              type="text"
              icon={<DownloadOutlined style={{ fontSize: 20 }} />}
              aria-label="导出项目"
              disabled={!document || state.connection === 'forbidden'}
              onClick={() => {
                void session
                  .exportFiles()
                  .then((value) => {
                    const url = URL.createObjectURL(
                        new Blob([value.bytes], { type: 'application/zip' }),
                      ),
                      link = window.document.createElement('a')
                    link.href = url
                    link.download = value.filename
                    link.click()
                    setTimeout(() => URL.revokeObjectURL(url), 1000)
                  })
                  .catch((cause) =>
                    setError(
                      cause instanceof Error ? cause.message : '请恢复网络并验证项目权限后导出',
                    ),
                  )
              }}
            />
          </Tooltip>,
          exportTarget,
        )}
      {state.recoveries?.map((recovery) => (
        <div role="alert" className="v2-recovery" key={recovery.id}>
          <p>{recovery.path} 被远端删除，当前内容已保留。可恢复为新文件或复制内容。</p>
          <Button
            htmlType="button"
            disabled={!state.writable}
            onClick={async () => {
              const path = await dialogs.prompt('恢复文件路径（创建新文件）', recovery.path, 255)
              if (path)
                run(() => {
                  const id = session.mutate((d) => {
                    const next = fileCommands(d, session.identity, () => true).create(path)
                    const content = d
                      .getMap<Y.Map<unknown>>('files')
                      .get(next)!
                      .get('content') as Y.Text
                    content.insert(0, recovery.code)
                    return next
                  })
                  setChosenId(id)
                  session.dismissRecovery(recovery.id)
                })
            }}
          >
            恢复为新文件
          </Button>
          <Button
            htmlType="button"
            onClick={() => {
              void session
                .copyRecovery(recovery.id)
                .then(() => setNotice('内容已复制'))
                .catch((cause) => setError(cause instanceof Error ? cause.message : '复制失败'))
            }}
          >
            复制当前内容
          </Button>
          <Button danger htmlType="button" onClick={() => session.dismissRecovery(recovery.id)}>
            放弃保留内容
          </Button>
        </div>
      ))}

      {document ? (
        <>
          <div className="v2-workspace-toolbar" aria-label="工作区布局">
            <div className="v2-actions">
              <Tooltip title={showFiles ? '收起文件栏' : '展开文件栏'}>
                <Button
                  htmlType="button"
                  type="text"
                  icon={<FileOutlined style={{ fontSize: 20 }} />}
                  aria-label={showFiles ? '收起文件栏' : '展开文件栏'}
                  aria-expanded={showFiles}
                  aria-pressed={showFiles}
                  aria-controls="project-files-panel"
                  onClick={() => setShowFiles((value) => !value)}
                />
              </Tooltip>
              <Tooltip title={showCode ? '收起代码栏' : '展开代码栏'}>
                <Button
                  htmlType="button"
                  type="text"
                  icon={<CodeOutlined style={{ fontSize: 20 }} />}
                  aria-label={showCode ? '收起代码栏' : '展开代码栏'}
                  aria-expanded={showCode}
                  aria-pressed={showCode}
                  aria-controls="project-code-panel"
                  onClick={() => setShowCode((value) => !value)}
                />
              </Tooltip>
            </div>
            <div role="group" aria-label="预览模式">
              <Button aria-pressed={mode === 'design'} onClick={() => setMode('design')}>
                设计
              </Button>
              <Button aria-pressed={mode === 'run'} onClick={() => setMode('run')}>
                运行
              </Button>
            </div>
            {status}
            <Popover
              trigger="click"
              placement="bottomRight"
              open={showMembers}
              onOpenChange={setShowMembers}
              content={
                <ul id="project-members" className="v2-presence" aria-label="在线成员">
                  {members.length ? (
                    members.map((member) => (
                      <li
                        key={`${member.userId}:${member.connectionId}`}
                        style={{ borderColor: member.color }}
                      >
                        {member.name} · 连接 {member.connectionId.split('/')[0].slice(0, 8)}
                        {document.files.find((f) => f.id === member.activeFileId)?.path
                          ? ` · ${document.files.find((f) => f.id === member.activeFileId)!.path}`
                          : ''}
                      </li>
                    ))
                  ) : (
                    <li>暂无在线成员</li>
                  )}
                </ul>
              }
            >
              <Button
                className="v2-presence-toggle"
                htmlType="button"
                type="text"
                aria-label="在线成员"
                aria-expanded={showMembers}
                aria-controls="project-members"
              >
                <span className="v2-presence-summary">
                  <span style={{ color: members[0]?.color }}>{members[0]?.name ?? '在线成员'}</span>{' '}
                  · {members.length} 人在线
                </span>
                <DownOutlined rotate={showMembers ? 180 : 0} />
              </Button>
            </Popover>
          </div>
          <WorkspacePanels
            showFiles={showFiles}
            showCode={showCode}
            files={
              <aside id="project-files-panel" className="v2-file-panel" hidden={!showFiles}>
                <WorkspaceFileExplorer
                  files={document.files}
                  directories={document.directories}
                  activeId={activeId}
                  entryFileId={document.entryFileId}
                  writable={state.writable}
                  onOpen={setChosenId}
                  onCreate={(path, kind) => {
                    if (kind === 'directory') commands.createDirectory(path)
                    else setChosenId(commands.create(path))
                  }}
                  onRename={(from, path) => {
                    commands.rename(from, path)
                    if (from !== path) setNotice('路径已更新；源码中的引用需要同步修改。')
                  }}
                  onDelete={(path) => {
                    const receipt = commands.remove(path)
                    return () => commands.restore(receipt)
                  }}
                  onSetEntry={(id) => commands.setEntry(id)}
                />
              </aside>
            }
            code={
              <div id="project-code-panel" className="v2-code-panel" hidden={!showCode}>
                <MonacoWorkspace
                  session={session}
                  files={document.files}
                  activeId={activeId}
                  writable={state.writable}
                  sourceLocation={sourceLocation}
                />
              </div>
            }
            preview={
              mode === 'design' ? (
                <DesignCanvas
                  file={document.files.find((f) => f.id === activeId)}
                  files={document.files}
                  onLocate={locateSource}
                />
              ) : (
                <SandpackBridge
                  session={session}
                  entry={entry}
                  structureKey={JSON.stringify(document.files.map((f) => f.path).sort())}
                />
              )
            }
          />
        </>
      ) : (
        <>
          {status}
          <p>
            {state.connection === 'failed'
              ? '协作服务不可用，文档尚未加载。'
              : state.connection === 'forbidden'
                ? '项目授权已失效，文档已清除。'
                : '正在加载协作文档…'}
          </p>
        </>
      )}
      {dialogs.holder}
    </section>
  )
}

export default function ProjectWorkspace({
  project,
  userId,
  teamId,
  exportTarget,
}: {
  project: TeamProjectDetails
  userId: number
  teamId: number
  exportTarget: HTMLElement | null
}) {
  const [session, setSession] = useState<CollaborationSession | null>(null)
  const projectId = project.id,
    epoch = project.collaboration.epoch
  useEffect(() => {
    const next = new CollaborationSession({ projectId, epoch }, userId, teamId)
    let disposed = false
    queueMicrotask(() => {
      if (!disposed) {
        setSession(next)
        void next.connect()
      }
    })
    return () => {
      disposed = true
      next.destroy()
    }
  }, [projectId, epoch, userId, teamId])
  return session ? (
    <ConnectedWorkspace
      key={`${userId}:${projectId}:${epoch}`}
      session={session}
      exportTarget={exportTarget}
    />
  ) : (
    <p>正在准备协作工作区…</p>
  )
}
