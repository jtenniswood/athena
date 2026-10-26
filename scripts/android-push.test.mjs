import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { WebSocket, WebSocketServer } from 'ws'
import { createAndroidPush } from './android-push.mjs'

const deviceId = '11111111-1111-4111-8111-111111111111'
const bindingId = '22222222-2222-4222-8222-222222222222'
async function fixture(t) {
  const sent = [], waiters = []
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
  const relay = createAndroidPush({ target: `http://127.0.0.1:${gateway.address().port}`,
    sender: { enabled: true, send: async (...args) => { sent.push(args); waiters.shift()?.() } },
    fetch: async (_url, { headers }) => headers.cookie === 'session=A' || headers.cookie === 'session=B'
      ? Response.json({ user_id: headers.cookie, provider: 'test' }) : Response.json({}, { status: 401 })
  })
  const server = createServer((req, res) => { void relay.handle(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end() } }) })
  relay.attach(server)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    relay.close()
    for (const socket of upstream.clients) socket.terminate()
    upstream.close()
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => gateway.close(resolve))])
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const register = (changes = {}, account = 'A', method = 'POST') => fetch(origin + '/api/athena/android/push', {
    method, headers: { Origin: origin, Cookie: `session=${account}`, 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'http' },
    body: JSON.stringify({ deviceId, bindingId, token: 'fake-device-token-for-testing-only', enabled: true, foreground: false, ...changes })
  })
  const connect = () => new WebSocket(origin.replace('http:', 'ws:') + `/api/athena/android/ws?ticket=one-use&device=${deviceId}`,
    { headers: { Origin: origin, Cookie: 'session=A', 'X-Forwarded-Proto': 'http' } })
  const emit = (seq, status) => peer.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: {
    type: 'message.complete', session_id: 'runtime-1', seq, payload: { status, text: 'Private chat content must not reach Firebase' }
  } }))
  return { sent, register, connect, emit, nextPush: () => new Promise(resolve => waiters.push(resolve)) }
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
