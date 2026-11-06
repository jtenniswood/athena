import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'
import { WebSocket, WebSocketServer } from 'ws'
import { createGatewayCompatibility } from '../apps/web-desktop/server/gateway-compatibility.mjs'

async function fixture(t) {
  let clock = Date.now()
  const calls = [], upstream = createServer((req, res) => {
    res.writeHead(req.url === '/api/profiles' && req.headers['x-hermes-session-token'] === 'private-existing-token' ? 200 : 401)
    res.end('{}')
  }), sockets = new WebSocketServer({ server: upstream })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const target = `http://127.0.0.1:${upstream.address().port}`
  sockets.on('connection', (peer, req) => {
    calls.push({ url: req.url, origin: req.headers.origin, cookie: req.headers.cookie })
    peer.on('message', (data, binary) => peer.send(data, { binary }))
  })
  const compatibility = createGatewayCompatibility({ target, now: () => clock })
  const server = createServer((req, res) => { void compatibility.handle(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end() } }) })
  compatibility.attach(server)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    compatibility.close()
    for (const peer of sockets.clients) peer.terminate()
    sockets.close()
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => upstream.close(resolve))])
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const connect = (query, caller = origin) => new WebSocket(origin.replace('http:', 'ws:') + '/api/athena/gateway/ws?' + query,
    { headers: { Origin: caller, Cookie: 'session=existing-account' } })
  const rejected = async (query, caller) => {
    const client = connect(query, caller)
    client.on('error', () => {})
    return new Promise(resolve => client.on('unexpected-response', (_req, response) => {
      response.resume(); client.terminate(); resolve(response.statusCode)
    }))
  }
  const mint = (query = '', caller = origin, token = 'private-existing-token') => fetch(origin + '/api/athena/gateway/token-ticket?' + query, {
    method: 'POST', headers: { Origin: caller, 'X-Hermes-Session-Token': token }
  })
  return { calls, target, origin, connect, rejected, mint, advance: amount => { clock += amount } }
}

test('standard sockets retain Hermes tickets, profile routing and frames while normalizing the trusted proxy hop', async t => {
  const app = await fixture(t)
  const client = app.connect('socket=gateway&ticket=upstream-one-use&profile=research')
  await once(client, 'open')
  const response = once(client, 'message')
  client.send(JSON.stringify({ id: 1, method: 'config.get', params: { key: 'approvals.mode', profile: 'research' } }))
  assert.equal(JSON.parse(String((await response)[0])).method, 'config.get')
  assert.deepEqual(app.calls, [{ url: '/api/ws?profile=research&ticket=upstream-one-use', origin: app.target, cookie: 'session=existing-account' }])
  client.close(); await once(client, 'close')
  assert.equal(await app.rejected('ticket=upstream-one-use', 'https://another-site.test'), 403)
  assert.equal(await app.rejected('socket=host-terminal&ticket=upstream-one-use'), 401)
  assert.equal(app.calls.length, 1, 'rejected browser origins and unsupported sockets never reach Hermes')
})

test('static serve credentials stay behind expiring, scoped, single-use local handles', async t => {
  const app = await fixture(t)
  assert.equal((await app.mint('', 'https://another-site.test')).status, 403)
  assert.equal((await app.mint('', app.origin, 'invalid-token')).status, 401)
  const result = await (await app.mint('socket=transcribe-stream&profile=research')).json()
  assert.ok(!JSON.stringify(result).includes('private-existing-token'))
  const query = `socket=transcribe-stream&profile=research&athena_token_ticket=${result.ticket}`
  const client = app.connect(query)
  await once(client, 'open')
  assert.equal(app.calls[0].url, '/api/audio/transcribe-stream?profile=research&token=private-existing-token')
  client.close(); await once(client, 'close')
  assert.equal(await app.rejected(query), 401, 'a consumed credential cannot be replayed')
  const stale = await (await app.mint()).json()
  app.advance(30001)
  assert.equal(await app.rejected('athena_token_ticket=' + stale.ticket), 401)
  const scoped = await (await app.mint('profile=research')).json()
  assert.equal(await app.rejected('profile=personal&athena_token_ticket=' + scoped.ticket), 401)
  assert.equal(app.calls.length, 1)
})

test('browser standard dials use fresh login tickets and never put a saved token in a socket URL', async () => {
  const calls = []
  let staticToken = false, failure = 0
  const source = readFileSync(new URL('../apps/web-desktop/src/platform/standard-gateway.ts', import.meta.url), 'utf8')
  const context = vm.createContext({ exports: {}, URL, URLSearchParams, Error,
    window: { location: { origin: 'https://athena.example.test' } },
    require: () => ({ resolveToken: () => staticToken ? 'private-existing-token' : '', apiFetch: async request => {
      calls.push(request)
      if (failure && request.path === '/api/auth/ws-ticket') throw new Error(failure + ': rejected')
      if (staticToken && request.path === '/api/auth/ws-ticket') throw new Error('401: no_cookie')
      return { ticket: 'single-use-' + calls.length }
    } })
  })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
  const first = new URL(await context.exports.standardGatewaySocket('gateway', 'research'))
  const second = new URL(await context.exports.standardGatewaySocket('gateway', 'research'))
  assert.notEqual(first.searchParams.get('ticket'), second.searchParams.get('ticket'))
  assert.equal(first.searchParams.has('native_dial'), false, 'the released renderer selects its standard-server wire adapter')
  staticToken = true
  const tokenDial = new URL(await context.exports.standardGatewaySocket('speak-stream', 'research'))
  assert.equal(tokenDial.searchParams.get('athena_token_ticket'), 'single-use-4')
  assert.ok(!tokenDial.href.includes('private-existing-token'))
  assert.equal(calls.at(-1).path, '/api/athena/gateway/token-ticket?socket=speak-stream&profile=research')
  for (failure of [403, 503]) {
    const count = calls.length
    await assert.rejects(context.exports.standardGatewaySocket('gateway'), new RegExp(String(failure)))
    assert.equal(calls.length, count + 1, 'authorization and server failures do not switch credential paths')
  }
  failure = 401; staticToken = false
  await assert.rejects(context.exports.standardGatewaySocket('gateway'), error => error.needsOauthLogin === true)
})
