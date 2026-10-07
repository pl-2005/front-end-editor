// Local same-origin entry for acceptance and desktop use. Production uses nginx-v2.conf.
import { createServer, request as upstreamRequest } from 'node:http'
import { connect } from 'node:net'
import { readFileSync, statSync } from 'node:fs'
import { resolve, sep, extname } from 'node:path'

export function releaseEdge({ directory, apiPort, gatewayPort }) {
  const root = resolve(directory)
  const server = createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer')
    let path
    try { path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname) } catch { res.writeHead(400).end(); return }
    if (path.startsWith('/api/')) {
      const upstream = upstreamRequest({ hostname: '127.0.0.1', port: apiPort, path: req.url, method: req.method, headers: req.headers }, result => {
        res.writeHead(result.statusCode, result.headers); result.pipe(res)
      })
      upstream.on('error', () => {
        if (res.headersSent) res.destroy()
        else res.writeHead(503).end()
      })
      res.on('close', () => upstream.destroy()); req.pipe(upstream); return
    }
    if (path === '/api' || path.startsWith('/internal') || path.startsWith('/collab') || path.split('/').some(p => p.startsWith('.')) || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404).end(); return }
    let file = resolve(root, '.' + path)
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(404).end(); return }
    try { if (!statSync(file).isFile()) throw new Error() } catch {
      if (path.startsWith('/assets/')) { res.writeHead(404).end(); return }
      file = resolve(root, 'index.html')
    }
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }
    res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream'); res.setHeader('Cache-Control', 'no-store')
    res.end(req.method === 'HEAD' ? undefined : readFileSync(file))
  })
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/collaboration') { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return }
    const upstream = connect(gatewayPort, '127.0.0.1', () => {
      upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` + req.rawHeaders.reduce((s, v, i) => s + v + (i % 2 ? '\r\n' : ': '), '') + '\r\n')
      if (head.length) upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy()); socket.on('close', () => upstream.destroy())
  })
  return server
}
