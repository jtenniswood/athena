import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { WebSocket, WebSocketServer } from 'ws'
import { createAndroidPush } from './android-push.mjs'

const deviceId = '11111111-1111-4111-8111-111111111111'
const bindingId = '22222222-2222-4222-8222-222222222222'
async function fixture(t, options = {}) {
  const sent = [], attempts = [], waiters = []
  let failures = options.failures || 0, clock = Date.now()
  const directory = options.persist ? await mkdtemp(path.join(tmpdir(), 'athena-push-')) : undefined
  const gateway = createServer()
  const upstream = new WebSocketServer({ server: gateway })
  let peer
  upstream.on('connection', (socket, req) => {
    assert.equal(req.url, '/api/ws?ticket=one-use')
    assert.equal(req.headers.cookie, 'session=A')
    peer = socket
    socket.on('message', raw => {
      const frame = JSON.parse(raw)
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { session_id: 'runtime-1', stored_session_id: 'chat-1' } }))
    })
    socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready' } }))
  })
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve))
  const createRelay = () => createAndroidPush({ directory, now: () => clock, target: `http://127.0.0.1:${gateway.address().port}`,
    sender: { enabled: true, send: async (...args) => { attempts.push(args); if (failures-- > 0) throw new Error("Temporary sender outage"); sent.push(args); waiters.shift()?.() } },
    fetch: async (_url, { headers }) => headers.cookie === 'session=A' || headers.cookie === 'session=B'
      ? Response.json({ user_id: headers.cookie, provider: 'test' }) : Response.json({}, { status: 401 })
  })
  let relay = createRelay()
  const server = createServer((req, res) => { void relay.handle(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end() } }) })
  relay.attach(server)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    relay.close()
    for (const socket of upstream.clients) socket.terminate()
    upstream.close()
    await relay.drain()
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => gateway.close(resolve))])
    if (directory) await rm(directory, { recursive: true, force: true })
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const register = (changes = {}, account = 'A', method = 'POST') => fetch(origin + '/api/athena/android/push', {
    method, headers: { Origin: origin, Cookie: `session=${account}`, 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'http' },
    body: JSON.stringify({ deviceId, bindingId, tokenVersion: 0, token: 'fake-device-token-for-testing-only', enabled: true, foreground: false, ...changes })
  })
  const connect = () => new WebSocket(origin.replace('http:', 'ws:') + `/api/athena/android/ws?ticket=one-use&device=${deviceId}`,
    { headers: { Origin: origin, Cookie: 'session=A', 'X-Forwarded-Proto': 'http' } })
  const emit = (seq, status) => peer.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: {
    type: 'message.complete', session_id: 'runtime-1', seq, payload: { status, text: 'Private chat content must not reach Firebase' }
  } }))
  const status = async (account = 'A') => (await fetch(origin + '/api/athena/android/push?device=' + deviceId, { headers: { Cookie: `session=${account}` } })).json()
  const rotate = (changes = {}) => fetch(origin + '/api/athena/android/push/token', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, bindingId, refreshKey: 'k'.repeat(43), token: 'rotated-device-token-for-testing-only', ...changes })
  })
  const restart = async () => {
    relay.close(); await relay.drain()
    server.removeAllListeners('upgrade')
    relay = createRelay(); relay.attach(server)
    await relay.drain()
  }
  return { sent, attempts, register, connect, emit, status, rotate, restart, directory,
    advance: milliseconds => { clock += milliseconds }, drain: () => relay.drain(),
    nextPush: () => new Promise(resolve => waiters.push(resolve)) }
}

async function until(check) {
  const deadline = Date.now() + 4000
  while (!await check()) {
    assert.ok(Date.now() < deadline, 'Expected notification state was not reached')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

test('response completion reaches Firebase after the Android WebView disconnects', { timeout: 10000 }, async t => {
  const { register, connect, sent, emit, nextPush } = await fixture(t)
  assert.equal((await register()).status, 200)
  const client = connect()
  await once(client, 'open')
  const mounted = new Promise(resolve => {
    const handler = raw => { if (JSON.parse(raw).id === 1) { client.off('message', handler); resolve() } }
    client.on('message', handler)
  })
  client.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session.resume', params: { session_id: 'chat-1' } }))
  await mounted
  client.close(); await once(client, 'close')
  const pending = nextPush()
  emit(5, 'ok')
  await pending
  assert.equal(sent.length, 1)
  assert.equal(sent[0][1].focusSessionId, 'chat-1')
  assert.equal(sent[0][1].bindingId, bindingId)
  assert.equal(sent[0][2], 'HIGH')
  assert.ok(!JSON.stringify(sent).includes('Private chat content'))
  emit(5, 'ok')
  emit(6, 'interrupted')
  const final = nextPush()
  emit(7, 'error')
  await final
  assert.equal(sent.length, 2, 'duplicates and interrupted responses produce no additional alerts')
  assert.equal(sent[1][1].kind, 'turnError')
})

test('device registration requires authentication and sign-out removes its retained connection', { timeout: 10000 }, async t => {
  const { register, connect } = await fixture(t)
  assert.equal((await register({}, 'invalid')).status, 400)
  assert.equal((await register()).status, 200)
  const client = connect()
  await once(client, 'open')
  const closed = once(client, 'close')
  assert.equal((await register({}, 'A', 'DELETE')).status, 200)
  await closed
})


test('pending delivery and device bindings survive restart without retaining chat text or plaintext refresh keys', { timeout: 10000 }, async t => {
  const app = await fixture(t, { persist: true, failures: 1 })
  assert.equal((await app.register({ refreshKey: 'k'.repeat(43) })).status, 200)
  const client = app.connect(); await once(client, 'open')
  app.emit(9, 'ok')
  await until(async () => (await app.status()).pending === 1 && app.attempts.length === 1)
  await app.drain()
  const saved = await readFile(path.join(app.directory, 'android-push.json'), 'utf8')
  assert.ok(!saved.includes('Private chat content'))
  assert.ok(!saved.includes('k'.repeat(43)))
  assert.equal((await stat(path.join(app.directory, 'android-push.json'))).mode & 0o777, 0o600)
  app.advance(1001)
  await app.restart()
  assert.equal(app.sent.length, 1)
  const status = await app.status()
  assert.equal(status.registered, true)
  assert.equal(status.persistent, true)
  assert.equal(status.lastDelivery.state, 'accepted')
  assert.equal(status.lastDelivery.attempts, 2)
  assert.ok(!JSON.stringify(status).includes('fake-device-token'))
  await app.restart()
  assert.equal(app.sent.length, 1, 'accepted events are not resent after another restart')
  assert.equal((await app.status('B')).registered, false, 'another account cannot read this registration')
})

test('scoped native token rotation requires the current binding and cannot restore a signed-out registration', { timeout: 10000 }, async t => {
  const app = await fixture(t, { persist: true })
  assert.equal((await app.register({ refreshKey: 'k'.repeat(43) })).status, 200)
  assert.equal((await app.rotate({ refreshKey: 'x'.repeat(43) })).status, 400)
  assert.equal((await app.rotate({ bindingId: '33333333-3333-4333-8333-333333333333' })).status, 400)
  await app.restart()
  assert.equal((await app.rotate()).status, 200)
  const client = app.connect(); await once(client, 'open')
  const pending = app.nextPush(); app.emit(10, 'ok'); await pending
  assert.equal(app.sent[0][0], 'rotated-device-token-for-testing-only')
  assert.equal((await app.register({}, 'A', 'DELETE')).status, 200)
  assert.equal((await app.rotate()).status, 400)
  assert.equal((await app.status()).pending, 0)
})

test('expired queued events and disabled notification kinds are never sent on retry', { timeout: 10000 }, async t => {
  const app = await fixture(t, { persist: true, failures: 2 })
  await app.register()
  const client = app.connect(); await once(client, 'open')
  app.emit(11, 'ok'); await until(() => app.attempts.length === 1); await app.drain()
  await app.register({ kinds: { turnDone: false } })
  app.advance(2000); await app.drain()
  assert.equal(app.attempts.length, 1)
  await app.register()
  app.emit(12, 'ok'); await until(() => app.attempts.length === 2); await app.drain()
  app.advance(3600001); await app.restart()
  assert.equal(app.sent.length, 0)
  assert.equal((await app.status()).lastDelivery.state, 'expired')
})


test('a persistent installation seed produces a distinct native binding for each signed-in account', async t => {
  const app = await fixture(t)
  const first = await (await app.register({ accountScopedBinding: true })).json()
  const again = await (await app.register({ accountScopedBinding: true })).json()
  const second = await (await app.register({ accountScopedBinding: true }, 'B')).json()
  assert.equal(first.bindingId, again.bindingId)
  assert.notEqual(first.bindingId, second.bindingId)
  assert.equal((await app.status('A')).registered, false)
  assert.equal((await app.status('B')).registered, true)
})


test('native token refresh does not extend the authenticated registration lifetime', async t => {
  const app = await fixture(t)
  await app.register({ refreshKey: 'k'.repeat(43) })
  app.advance(23 * 3600000)
  assert.equal((await app.rotate()).status, 200)
  app.advance(2 * 3600000)
  assert.equal((await app.rotate()).status, 400)
})


test('out-of-order native and web registrations cannot roll back a newer FCM token', async t => {
  const app = await fixture(t, { persist: true })
  await app.register({ refreshKey: 'k'.repeat(43), tokenVersion: 1 })
  assert.equal((await app.rotate({ tokenVersion: 2 })).status, 200)
  assert.equal((await app.rotate({ tokenVersion: 1, token: 'older-token-for-testing-only' })).status, 409)
  assert.equal((await app.register({ refreshKey: 'k'.repeat(43), tokenVersion: 1 })).status, 200)
  await app.restart()
  const client = app.connect(); await once(client, 'open')
  const pending = app.nextPush(); app.emit(20, 'ok'); await pending
  assert.equal(app.sent[0][0], 'rotated-device-token-for-testing-only')
})


test('an unversioned older web client still updates its token but revokes incompatible native refresh', async t => {
  const app = await fixture(t)
  await app.register({ refreshKey: 'k'.repeat(43), tokenVersion: 2 })
  await app.register({ refreshKey: 'k'.repeat(43), tokenVersion: undefined, token: 'legacy-current-token-for-testing' })
  assert.equal((await app.rotate({ tokenVersion: 3 })).status, 400)
  const client = app.connect(); await once(client, 'open')
  const pending = app.nextPush(); app.emit(21, 'ok'); await pending
  assert.equal(app.sent[0][0], 'legacy-current-token-for-testing')
})
