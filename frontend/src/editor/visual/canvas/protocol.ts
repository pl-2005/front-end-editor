import type { SourceRegistry } from '../source/registry'
export interface SelectionMessage {
  type: 'select' | 'hover'
  fileId: string
  generation: string
  nodeId: string
  rect: { x: number; y: number; width: number; height: number }
}
export function validSelection(
  value: unknown,
  registry: SourceRegistry,
): value is SelectionMessage {
  if (!value || typeof value !== 'object') return false
  const m = value as Partial<SelectionMessage>
  if (
    Object.keys(m).sort().join(',') !== 'fileId,generation,nodeId,rect,type' ||
    !['select', 'hover'].includes(m.type ?? '') ||
    m.fileId !== registry.fileId ||
    m.generation !== registry.generation ||
    typeof m.nodeId !== 'string' ||
    m.nodeId.length > 160 ||
    !registry.nodes.has(m.nodeId)
  )
    return false
  return validRect(m.rect)
}
export function validRect(value: unknown): value is SelectionMessage['rect'] {
  if (!value || typeof value !== 'object') return false
  const rect = value as SelectionMessage['rect']
  return (
    !!rect &&
    Object.keys(rect).sort().join(',') === 'height,width,x,y' &&
    Object.values(rect).every(
      (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7,
    ) &&
    rect.width >= 0 &&
    rect.height >= 0
  )
}
export function validClearHover(value: unknown, registry: SourceRegistry): boolean {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  return (
    Object.keys(m).sort().join(',') === 'fileId,generation,type' &&
    m.type === 'clear-hover' &&
    m.fileId === registry.fileId &&
    m.generation === registry.generation
  )
}
export function validHello(value: unknown, capability: string, registry: SourceRegistry): boolean {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  return (
    Object.keys(m).sort().join(',') === 'capability,fileId,generation,type' &&
    m.type === 'hello' &&
    m.capability === capability &&
    m.fileId === registry.fileId &&
    m.generation === registry.generation
  )
}
