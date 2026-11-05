import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { WebSocket, WebSocketServer } from 'ws'
import { createOfficialHost } from '../apps/web-desktop/server/official-host.mjs'
import { createAthenaServices } from '../apps/web-desktop/server/services.mjs'
import { runtimeConfiguration } from './runtime-config.mjs'
import { accountIdentity } from '../apps/web-desktop/server/identity.mjs'

async function fixture(t) {
  const requests = []
  const backend = createServer((req, res) => {
    requests.push({ path: req.url, headers: req.headers })
    if (req.url === '/api/auth/me') {
      res.writeHead(req.headers.cookie === 'session=valid' ? 200 : 401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ provider: 'basic', user_id: 'operator' }))
    } else if (req.headers.cookie !== 'session=valid') {
      res.writeHead(302, { Location: '/login' }); res.end()
    } else if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
      res.end('<html><head><script>window.__HERMES_UI_SURFACE__="webapp"</script></head><body>Official bootstrap</body></html>')
    } else {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: first\n\n')
      setImmediate(() => res.end('data: second\n\n'))
    }
  })
  const sockets = new WebSocketServer({ server: backend })
  sockets.on('connection', socket => socket.on('message', message => socket.send(message)))
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening')
  const directory = await mkdtemp(path.join(tmpdir(), 'athena-official-host-'))
  const configuration = runtimeConfiguration({
    HERMES_GATEWAY_URL: `http://127.0.0.1:${backend.address().port}`,
    HERMES_PREFERENCES_DIR: directory,
    ATHENA_PREFERENCES_IDENTITY_URL: 'http://previous-gateway.test:9119'
  })
  const services = createAthenaServices({ target: configuration.target, identityTarget: configuration.identityTarget,
    directory, pluginAssets: false, sender: { enabled: false } })
  const host = createOfficialHost({ configuration, services, publicUrl: 'https://athena.example.test' })
  host.listen(0, '127.0.0.1'); await once(host, 'listening')
  t.after(async () => {
    for (const socket of sockets.clients) socket.terminate()
    services.close(); host.closeAllConnections(); backend.closeAllConnections()
    await Promise.all([new Promise(resolve => host.close(resolve)), new Promise(resolve => backend.close(resolve))])
    await rm(directory, { recursive: true, force: true })
  })
  return { url: `http://127.0.0.1:${host.address().port}`, requests, configuration }
}

test('the official host retains sign-in, bootstrap and streaming while isolating preference identity from transport', async t => {
  const f = await fixture(t)
  const anonymous = await fetch(f.url, { redirect: 'manual' })
  assert.equal(anonymous.status, 302)
  assert.equal(anonymous.headers.get('location'), '/login')
  assert.equal((await fetch(f.url + '/api/athena/preferences')).status, 401)
  const headers = { Cookie: 'session=valid' }
  const page = await fetch(f.url, { headers })
  assert.match(await page.text(), /window.__HERMES_UI_SURFACE__="webapp"/)
  const stream = await fetch(f.url + '/api/stream?profile=research', { headers })
  assert.equal(await stream.text(), 'data: first\n\ndata: second\n\n')
  const forwarded = f.requests.find(req => req.path === '/api/stream?profile=research')
  assert.equal(forwarded.headers['x-forwarded-host'], 'athena.example.test')
  assert.equal(forwarded.headers['x-forwarded-proto'], 'https')
  const saved = await (await fetch(f.url + '/api/athena/preferences', { headers })).json()
  assert.equal(saved.accountId, accountIdentity(f.configuration.identityTarget, { provider: 'basic', user_id: 'operator' }))
  assert.notEqual(f.configuration.identityTarget, f.configuration.target)
  const runtime = await (await fetch(f.url + '/runtime-config.js')).text()
  assert.match(runtime, new RegExp(f.configuration.publicConfig.gateway.id))
})

test('ticketed Hermes websocket upgrades keep the original query and messages', async t => {
  const f = await fixture(t)
  const socket = new WebSocket(f.url.replace('http:', 'ws:') + '/api/ws?ticket=one-use&native_dial=1&profile=research', {
    headers: { Cookie: 'session=valid' }
  })
  t.after(() => socket.terminate())
  await once(socket, 'open')
  const received = once(socket, 'message')
  socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'gateway.ping' }))
  assert.equal((await received)[0].toString(), '{"jsonrpc":"2.0","id":1,"method":"gateway.ping"}')
  socket.close(); await once(socket, 'close')
})
