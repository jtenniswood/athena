import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { WebSocket, WebSocketServer } from 'ws'
import { createAthenaServices } from '../apps/web-desktop/server/services.mjs'

const deviceId = '11111111-1111-4111-8111-111111111111'
const bindingId = '22222222-2222-4222-8222-222222222222'
async function fixture(t, options = {}) {
  const sent = [], attempts = [], waiters = []
  let failures = options.failures || 0, clock = Date.now()
  const title = options.title ?? 'A named chat'
  const directory = options.persist ? await mkdtemp(path.join(tmpdir(), 'athena-push-')) : undefined
  const gateway = createServer()
  const upstream = new WebSocketServer({ server: gateway })
  const rows = [], transcripts = new Map(), browserSent = []
  let peer
  upstream.on('connection', (socket, req) => {
    assert.equal(req.url, options.tokenTicket ? '/api/ws?token=private-existing-token' : options.protocols ? '/api/ws?native_dial=browser' : '/api/ws?ticket=one-use')
    assert.equal(req.headers.cookie || '', options.tokenTicket ? '' : 'hermes_session_at=A')
    assert.equal(req.headers.origin, `http://127.0.0.1:${gateway.address().port}`)
    if (options.protocols) assert.equal(req.headers['sec-websocket-protocol'], options.protocols.join(','))
    peer = socket
    socket.on('message', raw => {
      const frame = JSON.parse(raw)
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { session_id: 'runtime-1', stored_session_id: 'chat-1' } }))
    })
    socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready' } }))
  })
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve))
  const createRelay = () => createAthenaServices({ directory, now: () => clock, target: `http://127.0.0.1:${gateway.address().port}`,
    browserSender: { enabled: true, publicKey: () => 'public-key', send: async (...args) => browserSent.push(args) },
    sender: { enabled: true, send: async (...args) => { attempts.push(args); if (failures-- > 0) throw new Error("Temporary sender outage"); sent.push(args); waiters.shift()?.() } },
    fetch: async (url, { headers }) => {
      const address = new URL(url)
      const authorized = headers.cookie === 'hermes_session_at=A' || headers['x-hermes-session-token'] === 'private-existing-token'
      if (address.pathname === '/api/profiles/sessions') {
        if (!authorized || options.authExpired?.()) return new Response(null, { status: 401 })
        assert.equal(address.searchParams.get('profile'), 'all')
        return Response.json({ sessions: rows })
      }
      if (address.pathname.endsWith('/messages')) {
        if (!authorized || options.authExpired?.()) return new Response(null, { status: 401 })
        assert.equal(address.searchParams.get('inline_images'), 'false')
        return Response.json({ pagination: { order: 'latest' }, messages: transcripts.get(address.pathname.split('/')[3]) || [] })
      }
      if (address.pathname.startsWith('/api/sessions/')) {
        assert.ok(authorized)
        options.onTitleRead?.(address)
        return Response.json({ title })
      }
      return options.tokenTicket && (headers['X-Hermes-Session-Token'] || headers['x-hermes-session-token']) === 'private-existing-token'
      ? Response.json({ user_id: 'static-token-account', provider: 'test' })
      : headers.cookie === 'hermes_session_at=A' || headers.cookie === 'hermes_session_at=B'
      ? Response.json({ user_id: headers.cookie, provider: 'test' }) : Response.json({}, { status: 401 })
    }
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
    method, headers: { Origin: origin, ...(options.tokenTicket ? { 'X-Hermes-Session-Token': 'private-existing-token' } : { Cookie: `hermes_session_at=${account}` }), 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'http' },
    body: JSON.stringify({ deviceId, bindingId, tokenVersion: 0, token: 'fake-device-token-for-testing-only', enabled: true, foreground: false, ...changes })
  })
  const connect = handle => new WebSocket(origin.replace('http:', 'ws:') + `/api/athena/android/ws?${options.tokenTicket ? 'socket=gateway&athena_token_ticket=' + handle : options.protocols ? 'native_dial=browser' : 'ticket=one-use'}&device=${deviceId}`, options.protocols || [],
    { headers: { Origin: origin, ...(options.tokenTicket ? {} : { Cookie: 'hermes_session_at=A' }), 'X-Forwarded-Proto': 'http' } })
  const browser = (changes = {}, account = 'A', method = 'POST', suffix = '') => fetch(origin + '/api/athena/browser/push' + suffix, {
    method, headers: { Origin: origin, Cookie: `hermes_session_at=${account}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, subscription: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) }
    }, enabled: true, ...changes })
  })
  const save = (id, message, attrs = {}) => {
    const messages = transcripts.get(id) || []
    messages.push({ id: messages.length + 1, timestamp: clock / 1000, ...message })
    transcripts.set(id, messages)
    const index = rows.findIndex(row => row.id === id)
    const row = { id, profile: 'research', title: 'New chat', last_active: clock / 1000, message_count: messages.length, ...attrs }
    if (index === -1) rows.unshift(row)
    else rows[index] = row
  }
  const mint = async () => (await (await fetch(origin + '/api/athena/gateway/token-ticket?socket=gateway', {
    method: 'POST', headers: { Origin: origin, 'X-Hermes-Session-Token': 'private-existing-token' }
  })).json()).ticket
  const event = (type, seq, payload, session = 'runtime-1') => peer.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: {
    type, session_id: session, seq, payload
  } }))
  const emit = (seq, status) => event('message.complete', seq, { status, text: 'Private chat content must not reach Firebase' })
  const preview = (eventId, changes = {}) => fetch(origin + '/api/athena/android/push/preview', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId, bindingId, previewKey: 'p'.repeat(43), ...changes })
  })
  const status = async (account = 'A') => (await fetch(origin + '/api/athena/android/push?device=' + deviceId, { headers: { Cookie: `hermes_session_at=${account}` } })).json()
  const rotate = (changes = {}) => fetch(origin + '/api/athena/android/push/token', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, bindingId, refreshKey: 'k'.repeat(43), token: 'rotated-device-token-for-testing-only', ...changes })
  })
  const testPush = (account = 'A') => fetch(origin + '/api/athena/android/push/test', {
    method: 'POST', headers: { Origin: origin, Cookie: `hermes_session_at=${account}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId })
  })
  const restart = async () => {
    relay.close(); await relay.drain()
    server.removeAllListeners('upgrade')
    relay = createRelay(); relay.attach(server)
    await relay.drain()
  }
  return { sent, browserSent, browser, save, scan: () => relay.scanReplies(), attempts, register, connect, mint, emit, event, preview, status, rotate, testPush, restart, directory,
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
  client.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session.resume', params: { session_id: 'chat-1', profile: 'research' } }))
  await mounted
  client.close(); await once(client, 'close')
  const pending = nextPush()
  emit(5, 'ok')
  await pending
  assert.equal(sent.length, 1)
  assert.equal(sent[0][1].focusSessionId, 'chat-1')
  assert.equal(sent[0][1].focusProfile, 'research')
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

test('Firebase briefly waits for the title and only the registered installation can fetch the preview from Athena', async t => {
  let lookup
  const app = await fixture(t, { title: 'New conversation', onTitleRead: url => { lookup = url } })
  assert.equal((await app.register({ previewKey: 'p'.repeat(43), refreshKey: 'k'.repeat(43) })).status, 200)
  const client = app.connect()
  await once(client, 'open')
  const reply = new Promise(resolve => {
    client.on('message', raw => { if (JSON.parse(raw).id === 1) resolve() })
  })
  client.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session.resume', params: { session_id: 'chat-1', profile: 'research' } }))
  await reply
  client.close(); await once(client, 'close')
  app.emit(8, 'complete')
  await until(() => lookup)
  assert.equal(lookup.pathname, '/api/sessions/chat-1')
  assert.equal(lookup.searchParams.get('profile'), 'research')
  assert.equal(app.sent.length, 0)
  const pending = app.nextPush()
  app.event('session.title', 9, { session_id: 'chat-1', title: 'Generated title' })
  await pending
  const data = app.sent[0][1]
  assert.equal(data.fetchPreview, 'true')
  assert.doesNotMatch(JSON.stringify(data), /Generated title|Private chat content/)
  assert.equal((await app.preview(data.eventId, { previewKey: 'k'.repeat(43) })).status, 404)
  assert.equal((await app.preview(data.eventId, { bindingId: 'another-binding' })).status, 404)
  assert.deepEqual(await (await app.preview(data.eventId)).json(), {
    chatTitle: 'Generated title', body: 'Private chat content must not reach Firebase'
  })
  await app.register({}, 'A', 'DELETE')
  assert.equal((await app.preview(data.eventId)).status, 404)
})

test('background approval, input and actionable system alerts respect their preferences', async t => {
  const app = await fixture(t)
  await app.register({ kinds: { input: false } })
  const client = app.connect(); await once(client, 'open')
  client.close(); await once(client, 'close')
  let pending = app.nextPush()
  app.event('clarify.request', 1, { prompt_id: 'question' })
  app.event('approval.request', 2, { prompt_id: 'approval', command: 'Private command' })
  await pending
  assert.deepEqual(app.sent.map(([, data]) => data.kind), ['approval'])
  assert.doesNotMatch(JSON.stringify(app.sent), /Private command/)
  await app.register()
  pending = app.nextPush()
  app.event('clarify.request', 3, { prompt_id: 'question' })
  await pending
  pending = app.nextPush()
  app.event('notification.show', 4, { level: 'warn', text: 'System detail' })
  await pending
  assert.equal(app.sent[1][1].kind, 'input')
  assert.equal(app.sent[2][1].title, 'Athena · System alert')
  assert.equal(app.sent[2][1].focusSessionId, undefined)
})

test('a settled approval is removed from the Firebase retry queue', async t => {
  const app = await fixture(t, { failures: 1 })
  await app.register()
  const client = app.connect()
  await once(client, 'open')
  app.event('approval.request', 1, { prompt_id: 'open-approval' })
  await until(() => app.attempts.length === 1)
  await app.drain()
  assert.equal((await app.status()).pending, 1)
  app.event('approval.settled', 2, { prompt_id: 'open-approval' })
  await until(async () => (await app.status()).pending === 0)
  app.advance(2000)
  await app.drain()
  assert.equal(app.attempts.length, 1)
  client.close()
  await once(client, 'close')
})

test('Android retained sockets preserve native ticket protocols without reflecting the credential', async t => {
  const app = await fixture(t, { protocols: ['hermes-gateway-v1', 'hermes-gateway-ticket.one-use'] })
  await app.register()
  const client = app.connect()
  await once(client, 'open')
  assert.equal(client.protocol, 'hermes-gateway-v1')
  client.close(); await once(client, 'close')
})

test('Android background connections consume standard token handles once and retain authenticated delivery', { timeout: 10000 }, async t => {
  const app = await fixture(t, { tokenTicket: true })
  assert.equal((await app.register()).status, 200)
  const handle = await app.mint()
  assert.ok(handle && !handle.includes('private-existing-token'))
  const client = app.connect(handle)
  await once(client, 'open')
  client.close(); await once(client, 'close')
  const pending = app.nextPush()
  app.emit(1, 'ok')
  await pending
  assert.equal(app.sent.length, 1)
  const replay = app.connect(handle)
  await new Promise(resolve => replay.once('error', resolve))
  assert.equal(app.sent.length, 1)
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
  app.event('message.complete', 12, { status: 'ok' }, 'runtime-2'); await until(() => app.attempts.length === 2); await app.drain()
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

test('push tests use the signed-in device, bypass category filters and are rate limited', async t => {
  const app = await fixture(t)
  await app.register({ kinds: { turnDone: false, turnError: false } })
  assert.equal((await app.testPush('B')).status, 409)
  assert.equal(app.sent.length, 0)
  assert.equal((await app.testPush()).status, 200)
  assert.equal(app.sent[0][1].kind, 'test')
  assert.equal(app.sent[0][1].bindingId, bindingId)
  assert.equal(app.sent[0][1].focusSessionId, undefined)
  await app.register()
  assert.equal((await app.testPush()).status, 429, 'registration heartbeats preserve the limit')
  assert.equal(app.sent.length, 1)
  await app.register({ enabled: false })
  assert.equal((await app.testPush()).status, 409)
})

test('saved replies and scheduled results reach both devices with no chat socket', async t => {
  const app = await fixture(t)
  app.save('old', { role: 'assistant', content: 'Old reply' })
  app.advance(1000)
  assert.equal((await app.register({ foreground: true, previewKey: 'p'.repeat(43) })).status, 200)
  assert.equal((await app.browser()).status, 200)
  app.advance(1000)
  app.save('scheduled', { role: 'user', content: 'Scheduled result', display_kind: 'internal_notification',
    display_metadata: { completion_note: ['cron:job:execution'] } }, { title: 'Nightly report' })
  app.save('prompt-only', { role: 'user', content: 'Waiting for a reply' })
  app.save('tool-only', { role: 'assistant', content: 'Working on it', tool_calls: [{ id: 'pending' }] })
  app.save('silent', { role: 'assistant', content: '[SILENT]' })
  app.save('unread-reply', { role: 'assistant', content: 'New reply' })
  app.save('active-cron', { role: 'assistant', content: 'Partial' }, { source: 'cron' })
  await app.scan()
  await app.drain()
  assert.deepEqual(app.sent.map(([, data]) => data.focusSessionId).sort(), ['scheduled', 'unread-reply'])
  assert.deepEqual(app.browserSent.map(([, data]) => data.focusSessionId).sort(), ['scheduled', 'unread-reply'])
  const [, scheduled, priority] = app.sent.find(([, data]) => data.focusSessionId === 'scheduled')
  assert.equal(priority, 'HIGH', 'a stale foreground heartbeat cannot delay a closed app alert')
  assert.equal(scheduled.focusProfile, 'research')
  assert.equal(scheduled.body, 'Your response is ready.')
  assert.equal((await (await app.preview(scheduled.eventId)).json()).body, 'Scheduled result')
  assert.doesNotMatch(JSON.stringify(app.browserSent), /Scheduled result|Nightly report|New reply/)
  app.advance(1000)
  app.save('scheduled', { role: 'user', content: 'Another report', display_metadata: { completion_note: ['next'] } })
  app.save('prompt-only', { role: 'assistant', content: 'Now it is ready' })
  await app.scan()
  await app.drain()
  assert.deepEqual(app.sent.map(([, data]) => data.focusSessionId).sort(), ['prompt-only', 'scheduled', 'unread-reply'])
  assert.deepEqual(app.browserSent.map(([, data]) => data.focusSessionId).sort(), ['prompt-only', 'scheduled', 'scheduled', 'unread-reply'])
})

test('expired chat credentials and notification preferences stop background delivery', async t => {
  let expired = false
  const app = await fixture(t, { authExpired: () => expired })
  await app.register({ kinds: { turnDone: false } })
  await app.browser()
  app.advance(1000)
  app.save('already-read', { role: 'assistant', content: 'Read reply' }, { last_read_at: Number.MAX_SAFE_INTEGER })
  app.save('visible', { role: 'assistant', content: 'Displayed' })
  await app.browser({ visibleSession: 'visible' })
  await app.scan()
  await app.drain()
  assert.equal(app.sent.length + app.browserSent.length, 0)
  expired = true
  app.advance(1000)
  app.save('new', { role: 'assistant', content: 'Private reply' })
  await app.scan()
  assert.equal(app.browserSent.length, 0)
  expired = false
  await app.browser({}, 'A', 'DELETE')
  await app.scan()
  assert.equal(app.browserSent.length, 0)
  assert.equal((await app.browser({}, 'A', 'POST', '/test')).status, 409)
  assert.equal((await app.browser({ subscription: { endpoint: 'https://localhost/api' } })).status, 400)
})

test('an untitled completed reply still reaches Android', async t => {
  const app = await fixture(t, { title: 'New chat' })
  await app.register()
  const client = app.connect()
  await once(client, 'open')
  const pending = app.nextPush()
  app.emit(1, 'ok')
  await pending
  assert.equal(app.sent[0][1].kind, 'turnDone')
  assert.equal(app.sent[0][1].focusSessionId, 'runtime-1')
})
