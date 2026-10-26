import assert from 'node:assert/strict'
import { createServer as httpServer } from 'node:http'
import { createServer as tcpServer } from 'node:net'
import { once } from 'node:events'
import test from 'node:test'
import { waitForServices } from './wait-dev-ready.mjs'

async function fixture(t, { status = 200, state = 'UP' } = {}) {
  const current = { status, state, paths: [] }
  const api = httpServer((request, response) => {
    current.paths.push(request.url)
    response.writeHead(current.status, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ data: { status: current.state } }))
  })
  const initializer = tcpServer(socket => socket.end())
  const gateway = tcpServer(socket => socket.end())
  const servers = [api, initializer, gateway]
  t.after(async () => {
    await Promise.all(servers.map(server => new Promise(resolve => {
      server.close(resolve)
      server.closeAllConnections?.()
    })))
  })
  for (const server of servers) { server.listen(0, '127.0.0.1'); await once(server, 'listening') }
  const gatewayPort = gateway.address().port
  return {
    current, gateway, gatewayPort,
    config: {
      LOCAL_API_URL: `http://127.0.0.1:${api.address().port}`,
      COLLAB_INITIALIZER_URL: `http://127.0.0.1:${initializer.address().port}/internal/initialize`,
      LOCAL_COLLAB_URL: `ws://127.0.0.1:${gatewayPort}`,
    },
  }
}

const timing = { timeoutMs: 2000, intervalMs: 10, requestTimeoutMs: 100 }

test('waits for Spring readiness UP and the gateway to listen before allowing frontend startup', async t => {
  const { config, current, gateway, gatewayPort } = await fixture(t, { state: 'DOWN' })
  await new Promise(resolve => gateway.close(resolve))
  const pendingStates = []
  await waitForServices(config, {
    ...timing,
    onWaiting: pending => {
      pendingStates.push(pending)
      current.state = 'UP'
      if (!gateway.listening) gateway.listen(gatewayPort, '127.0.0.1')
    },
  })
  assert.ok(pendingStates[0].includes('后端 API'))
  assert.ok(pendingStates[0].includes('协作网关'))
  assert.ok(current.paths.length >= 2)
  assert.ok(current.paths.every(path => path === '/api/health/readiness'))
})

test('HTTP 503 times out and identifies the backend instead of allowing the browser to open', async t => {
  const { config } = await fixture(t, { status: 503, state: 'DOWN' })
  await assert.rejects(waitForServices(config, { ...timing, timeoutMs: 100 }), /超时：后端 API.*未打开浏览器/)
})

test('HTTP 200 without readiness UP is insufficient', async t => {
  const { config } = await fixture(t, { state: 'DOWN' })
  await assert.rejects(waitForServices(config, { ...timing, timeoutMs: 100 }), /超时：后端 API/)
})
