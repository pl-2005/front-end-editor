/** 只接受响应中非空的文本消息，空白或非文本值交由调用方兜底。 */
export function getResponseMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || !('message' in payload)) return undefined
  return typeof payload.message === 'string' && payload.message.trim()
    ? payload.message.trim()
    : undefined
}
