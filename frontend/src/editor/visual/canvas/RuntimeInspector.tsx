import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { CollaborationSession } from '../../../collaboration/session'
import { readDocument } from '../../../collaboration/document'
import type { SourceLocation } from './DesignCanvas'
import type { SourceRegistry } from '../source/registry'
import { validClearHover, validRect } from './protocol'
import type { RuntimeProjection } from './runtimeProjection'

interface Hit {
  type: 'hover' | 'select'
  fileId: string
  generation: string
  nodeId: string
  tag: string
  rect: { x: number; y: number; width: number; height: number }
}
export interface RuntimeInspectionProps {
  inspecting?: boolean
  onLocate?: (location: SourceLocation) => void
  onInspect?: (location?: SourceLocation) => void
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
  const connection = useRef<{
    port: MessagePort
    frame: HTMLIFrameElement
    registry: SourceRegistry
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
    const clear = () => {
      hovered = ''
      setHover(undefined)
      inspect(undefined)
    }
    const reset = () => {
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
      connection.current?.port.postMessage({ type: 'refresh' })
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
        connection.current
      )
        return
      const channel = new MessageChannel()
      connection.current = { frame, registry, port: channel.port1 }
      observer.observe(frame)
      setRegistry(registry)
      channel.port1.onmessage = ({ data: message }) => {
        if (connection.current?.port !== channel.port1 || !fresh(registry)) return
        if (
          message?.type === 'ready' &&
          message.fileId === registry.fileId &&
          message.generation === registry.generation
        ) {
          setConnected(true)
          channel.port1.postMessage({ type: 'mode', active: enabled() })
          geometry()
          return
        }
        if (
          message?.type === 'mode-ready' &&
          message.fileId === registry.fileId &&
          message.generation === registry.generation
        ) {
          locked = ''
          setSelection(undefined)
          clear()
          return
        }
        if (!enabled()) return
        if (
          message?.type === 'clear-selection' &&
          Object.keys(message).sort().join(',') === 'fileId,generation,type' &&
          message.fileId === registry.fileId &&
          message.generation === registry.generation
        ) {
          locked = ''
          setSelection(undefined)
          return
        }
        if (validClearHover(message, registry)) {
          clear()
          return
        }
        if (
          !message ||
          typeof message !== 'object' ||
          Object.keys(message).sort().join(',') !== 'fileId,generation,nodeId,rect,tag,type' ||
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
          (message.nodeId !== '' && !registry.nodes.has(message.nodeId)) ||
          !validRect(message.rect)
        )
          return
        const node = registry.nodes.get(message.nodeId)
        if (node && node.tag !== tag) return
        const hit = message as Hit
        if (hit.type === 'hover') setHover(hit)
        else setSelection(hit)
        const previous = hit.type === 'hover' ? hovered : locked
        const identity = hit.nodeId || `dynamic:${tag}`
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
      channel.port1.start()
      frame.contentWindow!.postMessage(
        {
          type: 'runtime-connect',
          capability: projection.capability,
          generation: registry.generation,
        },
        '*',
        [channel.port2],
      )
    }
    const clearHover = () => {
      clear()
      connection.current?.port.postMessage({ type: 'clear-hover' })
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearHover()
    }
    const change = () => {
      const current = connection.current
      if (current && !fresh(current.registry)) {
        current.port.postMessage({ type: 'mode', active: false })
        reset()
      }
    }
    const loaded = (event: Event) => {
      if (event.target === connection.current?.frame) reset()
    }
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
      connection.current?.port.postMessage({ type: 'mode', active: false })
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
  useEffect(() => {
    inspect(undefined)
    connection.current?.port.postMessage({ type: 'mode', active: inspecting })
  }, [inspecting])
  useEffect(() => {
    if (!inspecting || connected) return
    const timer = setTimeout(() => setUnavailable(true), 5000)
    return () => clearTimeout(timer)
  }, [inspecting, connected])
  const node = selection && registry?.nodes.get(selection.nodeId)
  const reason = selection?.nodeId === '' ? '运行时生成的元素，无明确源码位置' : node?.reason
  return (
    <div ref={host} className="v3-runtime-preview">
      {children}
      {inspecting && (
        <>
          <div className="v3-runtime-actions">
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
              onClick={() => connection.current?.port.postMessage({ type: 'parent' })}
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
                  readDocument(session.doc, session.identity).files.some(
                    (file) =>
                      file.id === registry.fileId && file.content.toString() === registry.source,
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
                  >
                    {index === 1 && (
                      <span>{`<${hit.tag}> · ${Math.round(hit.rect.width)} × ${Math.round(hit.rect.height)}${hit.nodeId ? '' : ' · 运行时元素'}`}</span>
                    )}
                  </div>
                ),
            )}
          </div>
        </>
      )}
    </div>
  )
}
