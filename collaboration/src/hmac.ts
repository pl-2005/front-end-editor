import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
/**
 * 计算请求体的 SHA-256 小写十六进制摘要。
 *
 * @param body 请求体
 */
export const hash = (body: Uint8Array): string => createHash('sha256').update(body).digest('hex')
/**
 * 按方法、路径、受众、时间戳、nonce 和正文摘要的固定顺序生成 HMAC-SHA256。
 *
 * @param secret 签名密钥
 * @param method HTTP 请求方法
 * @param path 目标路径
 * @param audience 内部请求或令牌的受众标识
 * @param timestamp 请求时间戳，单位为秒
 * @param nonce 单次请求随机标识
 * @param body 请求体
 */
export function signature(secret: string, method: string, path: string, audience: string, timestamp: string, nonce: string, body: Uint8Array): string {
  return createHmac('sha256', secret).update([method, path, audience, timestamp, nonce, hash(body)].join('\n')).digest('hex')
}
/**
 * 校验小写十六进制签名格式后执行恒定时间比较。
 *
 * @param actual 待验证签名
 * @param expected 服务端计算的有效签名
 */
export function equal(actual: string, expected: string): boolean {
  return /^[a-f0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
}
