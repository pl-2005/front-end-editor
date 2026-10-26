import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import type { CollaborationSession } from '../../../collaboration/session'
import { readDocument } from '../../../collaboration/document'
import type { SourceLocation } from './DesignCanvas'
import type { SourceRegistry } from '../source/registry'
import { validRect } from './protocol'
import type { RuntimeProjection } from './runtimeProjection'

interface Hit {
  type: 'hover' | 'select'
  fileId: string
  generation: string
  nodeId: string
  modeRevision: number
  sourceStatus: 'candidate' | 'ambiguous' | 'unmapped'
  sourceReason: string
  tag: string
  rect: { x: number; y: number; width: number; height: number }
}
export interface RuntimeInspectionProps {
  inspecting?: boolean
  onLocate?: (location: SourceLocation) => void
  onInspect?: (location?: SourceLocation) => void
}

function HoverLabel({ hit, viewport }: { hit: Hit; viewport: RefObject<HTMLDivElement | null> }) {
  const label = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const element = label.current
    if (!element || !viewport.current) return
    const frame = viewport.current.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    const left = Math.max(0, frame.left, frame.left + hit.rect.x)
    const top = Math.max(0, frame.top, frame.top + hit.rect.y)
    const right = Math.min(window.innerWidth, frame.right, frame.left + hit.rect.x + hit.rect.width)
    const bottom = Math.min(
      window.innerHeight,
      frame.bottom,
      frame.top + hit.rect.y + hit.rect.height,
    )
    const gap = 6
    const x = Math.max(0, Math.min(left, window.innerWidth - box.width))
    const y = Math.max(0, Math.min(top, window.innerHeight - box.height))
    const position = [
      { x, y: top - box.height - gap },
      { x, y: bottom + gap },
      { x: right + gap, y },
      { x: left - box.width - gap, y },
    ].find(
      (candidate) =>
        candidate.x >= 0 &&
        candidate.y >= 0 &&
        candidate.x + box.width <= window.innerWidth &&
        candidate.y + box.height <= window.innerHeight,
    )
    element.style.visibility = position && right > left && bottom > top ? 'visible' : 'hidden'
    if (position) {
      element.style.left = `${position.x}px`
      element.style.top = `${position.y}px`
    }
  })
  return createPortal(
    <span ref={label} className="v3-runtime-hover-label" aria-hidden="true">
      {`<${hit.tag}> · ${Math.round(hit.rect.width)} × ${Math.round(hit.rect.height)}${hit.nodeId ? '' : ' · 运行时元素'}`}
    </span>,
    document.body,
  )
}

export function RuntimeInspector({
  session,
  projection,
  inspecting = false,
  onLocate,
  onInspect,
  children,
}: RuntimeInspectionProps & {
  session: CollaborationSession
  projection: RuntimeProjection
  children: ReactNode
}) {
  const host = useRef<HTMLDivElement>(null)
  const overlays = useRef<HTMLDivElement>(null)
  const modeRevision = useRef(0)
  const clearMode = useRef<() => void>(() => {})
  const connection = useRef<{
    port: MessagePort
    frame: HTMLIFrameElement
    registry: SourceRegistry
    acknowledged: number
    ready: boolean
  } | null>(null)
  const [hover, setHover] = useState<Hit>()
  const [selection, setSelection] = useState<Hit>()
  const [connected, setConnected] = useState(false)
  const [registry, setRegistry] = useState<SourceRegistry>()
  const [unavailable, setUnavailable] = useState(false)
  const [offset, setOffset] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const inspect = useEffectEvent((location?: SourceLocation) => onInspect?.(location))
  const locate = useEffectEvent((location: SourceLocation) => onLocate?.(location))
  const enabled = useEffectEvent(() => inspecting)
  const fresh = useEffectEvent((registry: SourceRegistry) => {
    try {
      return readDocument(session.doc, session.identity).files.some(
        (file) =>
          file.id === registry.fileId &&
          file.path === registry.path &&
          file.content.toString() === registry.source,
      )
    } catch {
      return false
    }
  })
  useLayoutEffect(() => {
    const root = host.current!
    let hovered = ''
    let locked = ''
    let pending = 0
    let handshakeTimeout: ReturnType<typeof setTimeout> | undefined
    const queued = new Map<'hover' | 'select', Hit>()
    const cancel = () => {
      cancelAnimationFrame(pending)
      pending = 0
      queued.clear()
    }
    const clear = () => {
      queued.delete('hover')
      hovered = ''
      setHover(undefined)
      inspect(undefined)
    }
    clearMode.current = () => {
      setConnected(false)
      cancel()
      locked = ''
      setSelection(undefined)
      clear()
    }
    const reset = () => {
      clearTimeout(handshakeTimeout)
      handshakeTimeout = undefined
      cancel()
      if (connection.current) observer.unobserve(connection.current.frame)
      connection.current?.port.close()
      connection.current = null
      setConnected(false)
      setUnavailable(false)
      setRegistry(undefined)
      setSelection(undefined)
      locked = ''
      clear()
    }
    const geometry = () => {
      const frame = connection.current?.frame
      if (!frame) return
      const outer = root.getBoundingClientRect(),
        inner = frame.getBoundingClientRect()
      setOffset({
        x: inner.x - outer.x,
        y: inner.y - outer.y,
        width: inner.width,
        height: inner.height,
      })
      connection.current?.port.postMessage({ type: 'refresh', modeRevision: modeRevision.current })
    }
    const hello = (event: MessageEvent) => {
      const data = event.data
      if (
        !data ||
        typeof data !== 'object' ||
        Object.keys(data).sort().join(',') !== 'capability,fileId,generation,type' ||
        data.type !== 'runtime-hello' ||
        data.capability !== projection.capability
      )
        return
      const frame = [...root.querySelectorAll('iframe')].find(
        (frame) => event.source === frame.contentWindow,
      )
      const registry = projection.registries.get(data.fileId)
      if (
        !frame ||
        !registry ||
        registry.generation !== data.generation ||
        !fresh(registry) ||
        connection.current?.ready
      )
        return
      // A queued hello from a previous document can arrive after its load event.
      // It cannot monopolize the channel while the new document is handshaking.
      if (connection.current) reset()
      const channel = new MessageChannel()
      connection.current = { frame, registry, port: channel.port1, acknowledged: 0, ready: false }
      handshakeTimeout = setTimeout(() => {
        if (connection.current?.port !== channel.port1 || connection.current.ready) return
        reset()
        setUnavailable(true)
      }, 5000)
      observer.observe(frame)
      setRegistry(registry)
      channel.port1.onmessage = ({ data: message }) => {
        // Y.Doc updates validate and close stale connections synchronously.
        // High-frequency hits never stringify the source or rescan the project.
        if (connection.current?.port !== channel.port1) return
        if (
          message?.type === 'ready' &&
          Object.keys(message).sort().join(',') === 'fileId,generation,type' &&
          message.fileId === registry.fileId &&
          message.generation === registry.generation
        ) {
          if (connection.current.ready) return
          connection.current.ready = true
          clearTimeout(handshakeTimeout)
          handshakeTimeout = undefined
          setUnavailable(false)
          channel.port1.postMessage({
            type: 'mode',
            active: enabled(),
            modeRevision: modeRevision.current,
          })
          geometry()
          return
        }
        if (!connection.current.ready) return
        if (
          message?.type === 'mode-ready' &&
          Object.keys(message).sort().join(',') === 'fileId,generation,modeRevision,type' &&
          message.modeRevision === modeRevision.current &&
          message.fileId === registry.fileId &&
          message.generation === registry.generation
        ) {
          connection.current.acknowledged = message.modeRevision
          setConnected(true)
          return
        }
        if (
          !enabled() ||
          message?.modeRevision !== modeRevision.current ||
          connection.current.acknowledged !== modeRevision.current
        )
          return
        if (
          message?.type === 'clear-selection' &&
          Object.keys(message).sort().join(',') === 'fileId,generation,modeRevision,type' &&
          message.fileId === registry.fileId &&
          message.generation === registry.generation
        ) {
          locked = ''
          queued.delete('select')
          setSelection(undefined)
          return
        }
        if (
          message?.type === 'clear-hover' &&
          Object.keys(message).sort().join(',') === 'fileId,generation,modeRevision,type' &&
          message.fileId === registry.fileId &&
          message.generation === registry.generation
        ) {
          clear()
          return
        }
        if (
          !message ||
          typeof message !== 'object' ||
          Object.keys(message).sort().join(',') !==
            'fileId,generation,modeRevision,nodeId,rect,sourceReason,sourceStatus,tag,type' ||
          typeof message.tag !== 'string' ||
          !/^[a-z][a-z0-9:-]{0,79}$/.test(message.tag)
        )
          return
        const { tag } = message
        // Unknown DOM nodes remain inspectable, but never get a source range.
        if (
          !['hover', 'select'].includes(message.type) ||
          message.fileId !== registry.fileId ||
          message.generation !== registry.generation ||
          typeof message.nodeId !== 'string' ||
          message.nodeId.length > 160 ||
          !['candidate', 'ambiguous', 'unmapped'].includes(message.sourceStatus) ||
          typeof message.sourceReason !== 'string' ||
          message.sourceReason.length > 500 ||
          (message.sourceStatus === 'candidate' ? !message.nodeId : message.nodeId !== '') ||
          (message.nodeId !== '' && !registry.nodes.has(message.nodeId)) ||
          !validRect(message.rect)
        )
          return
        const node = registry.nodes.get(message.nodeId)
        if (node && node.tag !== tag) return
        queued.set(message.type, message as Hit)
        if (!pending) pending = requestAnimationFrame(flush)
      }
      const consume = (hit: Hit) => {
        const node = registry.nodes.get(hit.nodeId)
        if (hit.type === 'hover') setHover(hit)
        else setSelection(hit)
        const previous = hit.type === 'hover' ? hovered : locked
        const identity = `${hit.sourceStatus}:${hit.nodeId || hit.tag}`
        if (hit.type === 'hover') hovered = identity
        else locked = identity
        if (previous === identity) return
        const location =
          node?.range && node.startTag && !node.reason
            ? {
                fileId: registry.fileId,
                source: registry.source,
                generation: registry.generation,
                range: node.range,
                requestId: crypto.randomUUID(),
              }
            : undefined
        if (hit.type === 'hover') inspect(location)
        else if (location) locate(location)
      }
      const flush = () => {
        pending = 0
        if (connection.current?.port === channel.port1 && enabled())
          for (const hit of queued.values())
            if (hit.modeRevision === modeRevision.current) consume(hit)
        queued.clear()
      }
      channel.port1.start()
      frame.contentWindow!.postMessage(
        {
          type: 'runtime-connect',
          capability: projection.capability,
          fileId: registry.fileId,
          generation: registry.generation,
        },
        '*',
        [channel.port2],
      )
    }
    const clearHover = () => {
      clear()
      connection.current?.port.postMessage({
        type: 'clear-hover',
        modeRevision: modeRevision.current,
      })
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearHover()
    }
    const change = () => {
      const current = connection.current
      if (current && !fresh(current.registry)) {
        current.port.postMessage({
          type: 'mode',
          active: false,
          modeRevision: ++modeRevision.current,
        })
        reset()
      }
    }
    const loaded = (event: Event) => {
      if (event.target === connection.current?.frame) reset()
    }
    const deactivate = () =>
      connection.current?.port.postMessage({
        type: 'mode',
        active: false,
        modeRevision: ++modeRevision.current,
      })
    window.addEventListener('message', hello)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', clearHover)
    window.addEventListener('resize', geometry)
    window.addEventListener('scroll', geometry, true)
    root.addEventListener('pointerleave', clearHover)
    root.addEventListener('load', loaded, true)
    const observer = new ResizeObserver(geometry)
    observer.observe(root)
    session.doc.on('update', change)
    return () => {
      deactivate()
      reset()
      observer.disconnect()
      session.doc.off('update', change)
      window.removeEventListener('message', hello)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', clearHover)
      window.removeEventListener('resize', geometry)
      window.removeEventListener('scroll', geometry, true)
      root.removeEventListener('pointerleave', clearHover)
      root.removeEventListener('load', loaded, true)
    }
  }, [session, projection])
  useLayoutEffect(() => {
    ++modeRevision.current
    clearMode.current()
    connection.current?.port.postMessage({
      type: 'mode',
      active: inspecting,
      modeRevision: modeRevision.current,
    })
  }, [inspecting])
  useEffect(() => {
    if (!inspecting || connected) return
    const timer = setTimeout(() => setUnavailable(true), 5000)
    return () => clearTimeout(timer)
  }, [inspecting, connected])
  const node = selection && registry?.nodes.get(selection.nodeId)
  const reason =
    [node?.reason, selection?.sourceReason].filter(Boolean).join(' · ') ||
    (selection?.sourceStatus === 'candidate' ? '仅关联候选源码，字段及结构写入尚未授权' : undefined)
  return (
    <div ref={host} className="v3-runtime-preview">
      {children}
      {inspecting && (
        <>
          <div className="v3-runtime-actions">
            {connected && registry && <span>当前检查：{registry.path}</span>}
            <span>
              {!connected
                ? unavailable
                  ? '当前运行页无法检查（脚本受限、HTML 超限或尚未就绪）；页面继续运行'
                  : '检查工具正在连接；页面保持运行'
                : selection
                  ? `<${selection.tag}>${reason ? ` · ${reason}` : ''}`
                  : '悬停检查，点击锁定'}
            </span>
            <button
              type="button"
              disabled={!selection}
              onClick={() =>
                connection.current?.port.postMessage({
                  type: 'parent',
                  modeRevision: modeRevision.current,
                })
              }
            >
              选择父级
            </button>
            <button
              type="button"
              disabled={!node?.range || !!node.reason}
              onClick={() => {
                if (
                  registry &&
                  node?.range &&
                  selection?.sourceStatus === 'candidate' &&
                  readDocument(session.doc, session.identity).files.some(
                    (file) =>
                      file.id === registry.fileId &&
                      file.path === registry.path &&
                      file.content.toString() === registry.source,
                  )
                )
                  onLocate?.({
                    fileId: registry.fileId,
                    source: registry.source,
                    generation: registry.generation,
                    range: node.range,
                    requestId: crypto.randomUUID(),
                    openCode: true,
                  })
              }}
            >
              打开源码并定位
            </button>
          </div>
          <div
            ref={overlays}
            className="v3-runtime-overlays"
            aria-hidden="true"
            style={{ left: offset.x, top: offset.y, width: offset.width, height: offset.height }}
          >
            {[selection, hover].map(
              (hit, index) =>
                hit && (
                  <div
                    key={index}
                    aria-hidden="true"
                    className={index ? 'v3-hover' : 'v3-selection'}
                    style={{
                      left: hit.rect.x,
                      top: hit.rect.y,
                      width: hit.rect.width,
                      height: hit.rect.height,
                    }}
                  />
                ),
            )}
          </div>
          {hover && <HoverLabel hit={hover} viewport={overlays} />}
        </>
      )}
    </div>
  )
}
