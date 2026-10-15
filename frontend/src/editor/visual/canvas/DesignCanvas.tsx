import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { FileRecord } from '../../../collaboration/document'
import { HTML_BYTES, parseSource, type SourceRange } from '../source/registry'
import { createProjection, type CanvasProjection } from './projection'
import { validHello, validSelection, type SelectionMessage } from './protocol'

export interface SourceLocation {
  fileId: string
  source: string
  range: SourceRange
  generation: string
  requestId: string
}
interface Props {
  file?: FileRecord
  files: FileRecord[]
  onLocate: (location: SourceLocation) => void
}

export function DesignCanvas({ file, files, onLocate }: Props) {
  const source = file?.content.toString() ?? ''
  const resources = JSON.stringify(
    files.filter((f) => f.language === 'css').map((f) => [f.path, f.content.toString()]),
  )
  const fileId = file?.id ?? ''
  const path = file?.path ?? ''
  const reason = !file
    ? '文档尚未初始化。'
    : file.language !== 'html'
      ? '请选择 HTML 文件；当前文件可在代码或运行模式查看。'
      : new TextEncoder().encode(source).length > HTML_BYTES
        ? 'HTML 超过 200 KiB，请使用代码或运行模式。'
        : ''
  const [built, setBuilt] = useState<{
    source: string
    resources: string
    projection?: CanvasProjection
    error?: string
  }>()
  const current =
    !reason &&
    built?.source === source &&
    built.resources === resources &&
    built.projection?.registry.fileId === fileId &&
    built.projection.registry.path === path
      ? built.projection
      : undefined
  useEffect(() => {
    if (reason) return
    const timer = setTimeout(() => {
      try {
        const css = (JSON.parse(resources) as [string, string][]).map(([path, source]) => ({
          path,
          source,
          language: 'css',
        }))
        setBuilt({
          source,
          resources,
          projection: createProjection(parseSource(fileId, path, source), css),
        })
      } catch (error) {
        setBuilt({
          source,
          resources,
          error: error instanceof Error ? error.message : '设计投影失败。',
        })
      }
    }, 180)
    return () => clearTimeout(timer)
  }, [fileId, path, source, resources, reason])
  const error = built?.source === source && built.resources === resources ? built.error : undefined
  return (
    <section className="v3-design" aria-label="只读设计画布">
      <p className="v3-design-notice">
        只读设计：点击元素可定位源码。插入、属性修改和删除将在后续步骤开放。
      </p>
      {reason || error ? (
        <p role="status">{reason || error}</p>
      ) : current ? (
        <CanvasFrame
          key={current.registry.generation}
          projection={current}
          file={file!}
          files={files}
          resources={resources}
          onLocate={onLocate}
        />
      ) : (
        <p role="status">正在更新设计副本…</p>
      )}
    </section>
  )
}

function CanvasFrame({
  projection,
  file,
  files,
  resources,
  onLocate,
}: {
  projection: CanvasProjection
  file: FileRecord
  files: FileRecord[]
  resources: string
  onLocate: Props['onLocate']
}) {
  const iframe = useRef<HTMLIFrameElement>(null)
  const port = useRef<MessagePort | null>(null)
  const [selection, setSelection] = useState<SelectionMessage>()
  const [status, setStatus] = useState('正在连接设计画布…')
  const registry = projection.registry
  const isFresh = useEffectEvent(
    () =>
      file.content.toString() === registry.source &&
      file.path === registry.path &&
      JSON.stringify(
        files.filter((f) => f.language === 'css').map((f) => [f.path, f.content.toString()]),
      ) === resources,
  )
  useEffect(() => {
    let consumed = false
    let selectedNode = ''
    let loads = 0
    let closed = false
    const fresh = () => !closed && isFresh()
    const close = () => {
      closed = true
      port.current?.close()
      port.current = null
    }
    const timeout = setTimeout(() => {
      close()
      setSelection(undefined)
      setStatus('设计通信超时，请切换模式后重试。')
    }, 5000)
    const hello = (event: MessageEvent) => {
      if (
        !fresh() ||
        consumed ||
        event.source !== iframe.current?.contentWindow ||
        !validHello(event.data, projection.capability, registry)
      )
        return
      consumed = true
      const channel = new MessageChannel()
      port.current = channel.port1
      channel.port1.onmessage = (event) => {
        if (!fresh()) return
        if (
          event.data?.type === 'ready' &&
          event.data.fileId === registry.fileId &&
          event.data.generation === registry.generation
        ) {
          clearTimeout(timeout)
          setStatus('')
          return
        }
        if (!validSelection(event.data, registry)) return
        setSelection(event.data)
        const node = registry.nodes.get(event.data.nodeId)!
        const changed = selectedNode !== event.data.nodeId
        selectedNode = event.data.nodeId
        if (changed && node.range && node.startTag && !node.reason)
          onLocate({
            fileId: registry.fileId,
            source: registry.source,
            generation: registry.generation,
            range: node.range,
            requestId: crypto.randomUUID(),
          })
      }
      channel.port1.start()
      iframe.current!.contentWindow!.postMessage(
        { type: 'connect', capability: projection.capability, generation: registry.generation },
        '*',
        [channel.port2],
      )
    }
    const loaded = () => {
      if (++loads > 1) {
        close()
        setSelection(undefined)
        setStatus('画布已重载，请切换模式重新连接。')
      }
    }
    const refresh = () => port.current?.postMessage({ type: 'refresh' })
    const frame = iframe.current!
    window.addEventListener('message', hello)
    frame.addEventListener('load', loaded)
    const observer = new ResizeObserver(refresh)
    observer.observe(frame)
    window.addEventListener('resize', refresh)
    return () => {
      close()
      clearTimeout(timeout)
      observer.disconnect()
      frame.removeEventListener('load', loaded)
      window.removeEventListener('message', hello)
      window.removeEventListener('resize', refresh)
    }
  }, [projection, registry, onLocate])
  const node = selection && registry.nodes.get(selection.nodeId)
  return (
    <>
      <div className="v3-design-actions">
        <span>{node ? `<${node.tag}> · ${node.reason ?? '源码范围明确'}` : '请选择画布元素'}</span>
        <button
          type="button"
          disabled={!node?.parentId}
          onClick={() => port.current?.postMessage({ type: 'parent' })}
        >
          选择父级
        </button>
        <button
          type="button"
          disabled={!node?.range || !node.startTag || !!node.reason}
          onClick={() => {
            if (node?.range && file.content.toString() === registry.source)
              onLocate({
                fileId: registry.fileId,
                source: registry.source,
                generation: registry.generation,
                range: node.range,
                requestId: crypto.randomUUID(),
              })
          }}
        >
          打开源码并定位
        </button>
      </div>
      {projection.issues.length > 0 && (
        <details className="v3-design-issues">
          <summary>设计资源提示（{projection.issues.length}）</summary>
          <ul>
            {projection.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </details>
      )}
      {status && <p role="status">{status}</p>}
      <div className="v3-canvas-viewport">
        <iframe
          ref={iframe}
          title="静态 HTML 设计画布"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={projection.srcdoc}
        />
        {selection && (
          <div
            aria-hidden="true"
            className="v3-selection"
            style={{
              left: selection.rect.x,
              top: selection.rect.y,
              width: selection.rect.width,
              height: selection.rect.height,
            }}
          />
        )}
      </div>
    </>
  )
}
