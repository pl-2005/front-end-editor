import { createServer } from 'node:http'
import { copyDocument, createDocument, encodeDocument, LIMITS, type FileInput } from './document.js'
import { equal, signature, hash } from './hmac.js'
import { NonceStore } from './internal.js'

const secret = process.env.COLLAB_INITIALIZER_SECRET ?? ''
if (Buffer.byteLength(secret) < 32) throw new Error('COLLAB_INITIALIZER_SECRET must contain at least 32 bytes')
// Loopback only; the initializer never receives storage credentials or executes project code.
const nonces = new NonceStore(process.env.COLLAB_INITIALIZER_NONCE_PATH ?? '../.codex-build/initializer-nonces.sqlite')
/**
 * 处理本机文档初始化请求：限制正文大小，校验 HMAC、时间窗及 nonce，
 * 创建或复制 Y.Doc 后返回完整二进制和摘要；响应完成后始终销毁临时文档。
 *
 * @param request 仅接受 POST /internal/initialize 的内部 HTTP 请求
 * @param response 返回二进制文档或对应 HTTP 错误的响应
 */
const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'POST' || request.url !== '/internal/initialize') { response.writeHead(404).end(); return }
    const timestamp = request.headers['x-collab-timestamp'], nonce = request.headers['x-collab-nonce'], supplied = request.headers['x-collab-signature']
    if (typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp) || typeof nonce !== 'string' || !/^[a-f0-9-]{36}$/.test(nonce)
      || typeof supplied !== 'string' || Math.abs(Date.now() / 1000 - Number(timestamp)) > 30) { response.writeHead(401).end(); return }
    const chunks: Buffer[] = []; let size = 0
    for await (const chunk of request) {
      size += chunk.length
      if (size > 18 * 1024 * 1024) { response.writeHead(413).end(); return }
      chunks.push(chunk)
    }
    const body = Buffer.concat(chunks)
    if (!equal(supplied, signature(secret, 'POST', request.url, 'initializer', timestamp, nonce, body))) { response.writeHead(401).end(); return }
    try { nonces.claim('initializer', nonce) } catch { response.writeHead(401).end(); return }
    const input = JSON.parse(body.toString()) as { projectId: number; epoch: number; entry: string; files: FileInput[]; source?: { projectId: number; epoch: number; bytes: string } }
    const target = { projectId: input.projectId, epoch: input.epoch }
    if (input.source && input.source.bytes.length > Math.ceil(LIMITS.documentBytes / 3) * 4) throw new Error('Document size limit exceeded')
    const doc = input.source ? copyDocument(Buffer.from(input.source.bytes, 'base64'), input.source, target) : createDocument(target, input.entry, input.files)
    try {
      const bytes = Buffer.from(encodeDocument(doc, target))
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length,
        'x-collab-content-hash': hash(bytes), 'x-collab-project-id': String(target.projectId), 'x-collab-epoch': String(target.epoch) }).end(bytes)
    } finally { doc.destroy() }
  } catch { response.writeHead(400).end('Invalid initialization request') }
})
server.requestTimeout = 15000
server.headersTimeout = 10000
server.listen(Number(process.env.COLLAB_INITIALIZER_PORT ?? 8091), '127.0.0.1')
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => nonces.close()))
