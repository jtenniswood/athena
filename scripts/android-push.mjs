import { createHash } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'

const root = '/api/athena/android/'
const retentionMs = 24 * 60 * 60 * 1000

/** Retain the authenticated gateway transport while Android suspends its WebView.
 * This forwards Hermes's own RPC protocol and stores no conversation history. */
export function createAndroidPush({ target, sender, fetch: request = globalThis.fetch, now = Date.now }) {
  const devices = new Map(), relays = new Set()
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 })
  const refreshedCookies = Symbol('refreshedCookies')
  sockets.on('headers', (headers, req) => {
    for (const cookie of req[refreshedCookies] || []) headers.push(`Set-Cookie: ${cookie}`)
  })
  const identity = async req => {
    const url = new URL(req.url, 'http://local.invalid')
    const headers = { cookie: req.headers.cookie || '',
      'x-hermes-session-token': req.headers['x-hermes-session-token'] || url.searchParams.get('token') || '',
      'x-forwarded-host': req.headers['x-forwarded-host'] || req.headers.host,
      'x-forwarded-proto': req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http') }
    const response = await request(target + '/api/auth/me', { headers, redirect: 'manual', signal: AbortSignal.timeout(6000) })
    if (!response.ok) throw new Error('Sign in required')
    const account = await response.json()
    if (typeof account.user_id !== 'string' || !account.user_id || typeof account.provider !== 'string') throw new Error('Invalid identity')
    return { id: createHash('sha256').update(JSON.stringify([target, account.provider, account.org_id || '', account.user_id])).digest('hex'),
      cookies: response.headers.getSetCookie() }
  }
  const requestOrigin = req => `${req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')}://${req.headers['x-forwarded-host'] || req.headers.host}`
  const keyFor = (account, deviceId) => `${account}:${deviceId}`
  const prune = () => {
    for (const [key, device] of devices) if (now() - device.updated > retentionMs) devices.delete(key)
    for (const relay of relays) if (!relay.client && now() - relay.detached > (relay.running.size ? retentionMs : 60000)) relay.close()
  }
  const timer = setInterval(() => {
    prune()
    for (const relay of relays) if (relay.upstream.readyState === WebSocket.OPEN) {
      relay.upstream.send(JSON.stringify({ jsonrpc: '2.0', id: '__athena_push_ping', method: 'gateway.ping', params: {} }))
    }
  }, 15000)
  timer.unref()

  async function handle(req, res) {
    if (new URL(req.url, 'http://local.invalid').pathname !== root + 'push') return false
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)) }
    if (!sender.enabled) return json(503, { error: 'Firebase push is not configured' }), true
    if (!['POST', 'DELETE'].includes(req.method) || req.headers.origin !== requestOrigin(req) || !req.headers['content-type']?.startsWith('application/json')) return json(403, { error: 'Same-origin JSON request required' }), true
    try {
      const authenticated = await identity(req)
      const account = authenticated.id
      if (authenticated.cookies.length) res.setHeader('Set-Cookie', authenticated.cookies)
      let raw = ''
      for await (const chunk of req) { raw += chunk; if (raw.length > 8192) throw new Error('Request too large') }
      const body = JSON.parse(raw)
      if (!/^[a-f0-9-]{36}$/.test(body.deviceId)) throw new Error('Invalid device')
      const key = keyFor(account, body.deviceId)
      if (req.method === 'DELETE') {
        devices.delete(key)
        for (const relay of relays) if (relay.key === key) relay.close()
      } else {
        if (typeof body.token !== 'string' || body.token.length < 20 || body.token.length > 4096) throw new Error('Invalid push token')
        if (!/^[a-f0-9-]{36}$/.test(body.bindingId)) throw new Error('Invalid binding')
        prune()
        if (!devices.has(key) && devices.size >= 500) throw new Error('Too many devices')
        // One installation belongs to the currently signed-in account only.
        for (const [other, device] of devices) if (other !== key && device.deviceId === body.deviceId) {
          devices.delete(other)
          for (const relay of relays) if (relay.key === other) relay.close()
        }
        const kinds = Object.fromEntries(['turnDone', 'turnError', 'approval', 'input'].map(kind => [kind, body.kinds?.[kind] !== false]))
        devices.set(key, { deviceId: body.deviceId, token: body.token, bindingId: body.bindingId, enabled: body.enabled === true, kinds,
          seen: devices.get(key)?.seen || new Set(),
          origin: requestOrigin(req), activeUntil: body.foreground === true ? now() + 45000 : 0, updated: now() })
      }
      json(200, { ok: true })
    } catch { json(400, { error: 'Could not register Android push notifications' }) }
    return true
  }

  function attach(server) {
    server.on('upgrade', async (req, socket, head) => {
      const url = new URL(req.url, 'http://local.invalid')
      if (url.pathname !== root + 'ws') return
      if (req.headers.origin !== requestOrigin(req) || !sender.enabled) { socket.destroy(); return }
      try {
        const authenticated = await identity(req), account = authenticated.id, deviceId = url.searchParams.get('device')
        req[refreshedCookies] = authenticated.cookies
        const key = keyFor(account, deviceId)
        const device = devices.get(key)
        if (!device || device.origin !== requestOrigin(req)) throw new Error('Register device first')
        if ([...relays].filter(relay => relay.key === key).length >= 8) throw new Error('Too many connections')
        url.searchParams.delete('device')
        const upstreamUrl = new URL(target + '/api/ws')
        upstreamUrl.protocol = upstreamUrl.protocol === 'https:' ? 'wss:' : 'ws:'
        upstreamUrl.search = url.search
        const upstream = new WebSocket(upstreamUrl, { headers: { Cookie: req.headers.cookie || '', Origin: requestOrigin(req),
          'X-Forwarded-Host': req.headers['x-forwarded-host'] || req.headers.host,
          'X-Forwarded-Proto': req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http') },
          handshakeTimeout: 10000, maxPayload: 8 * 1024 * 1024 })
        const relay = { key, upstream, client: null, detached: now(), sessions: new Map(), pending: new Map(), running: new Set(),
          close() { upstream.terminate(); relay.client?.terminate(); relays.delete(relay) } }
        relays.add(relay)
        const notify = async event => {
          const current = devices.get(key)
          if (!current?.enabled || event.type !== 'message.complete' || ['interrupted', 'cancelled'].includes(event.payload?.status)) return
          const sessionId = relay.sessions.get(event.session_id) || event.session_id
          if (typeof sessionId !== 'string' || !sessionId) return
          const kind = event.payload?.status === 'error' ? 'turnError' : 'turnDone'
          if (!kind || !current.kinds[kind]) return
          const eventKey = `${sessionId}:${event.replay_epoch || ''}:${event.seq ?? event.payload?.persisted_turn?.submission_id ?? Math.floor(now() / 1000)}`
          if (current.seen.has(eventKey)) return
          current.seen.add(eventKey)
          if (current.seen.size > 500) current.seen.delete(current.seen.values().next().value)
          const data = { kind, origin: current.origin, bindingId: current.bindingId, focusSessionId: sessionId, tag: `android:${sessionId}`,
            title: kind === 'turnDone' ? 'Athena · Response ready' : kind === 'turnError' ? 'Athena · Response failed' : 'Athena · Attention needed',
            body: kind === 'turnDone' ? 'Your response is ready.' : 'Open Athena to view this conversation.' }
          for (let attempt = 0; attempt < 3; attempt++) {
            if (devices.get(key) !== current) return
            try { await sender.send(current.token, data, current.activeUntil > now() ? 'NORMAL' : 'HIGH'); return } catch {
              if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
              else console.error('Athena Android push delivery failed')
            }
          }
        }
        upstream.on('open', () => {
          if (socket.destroyed) { upstream.close(); return }
          sockets.handleUpgrade(req, socket, head, client => {
            relay.client = client
            client.on('message', (data, binary) => {
              if (binary || upstream.readyState !== WebSocket.OPEN) return
              try {
                for (const line of data.toString().split('\n')) {
                  if (!line) continue
                  const frame = JSON.parse(line)
                  if (['session.resume', 'session.create', 'session.activate'].includes(frame.method) && frame.id != null) relay.pending.set(frame.id, frame.params?.session_id)
                }
              } catch { /* Hermes owns protocol validation. */ }
              upstream.send(data, { binary: false })
            })
            client.on('error', () => client.close())
            client.on('close', () => { relay.client = null; relay.detached = now() })
          })
        })
        upstream.on('message', (data, binary) => {
          if (binary) return
          const lines = data.toString().split('\n').filter(Boolean), forwarded = []
          for (const line of lines) {
            try {
              const frame = JSON.parse(line)
              if (frame.id === '__athena_push_ping') continue
              if (frame.result?.session_id) {
                const stored = frame.result.stored_session_id || relay.pending.get(frame.id) || frame.result.session_id
                relay.sessions.set(frame.result.session_id, stored)
                if (frame.result.running === true) relay.running.add(frame.result.session_id)
              }
              if (frame.id != null) relay.pending.delete(frame.id)
              if (frame.method === 'event') {
                const event = frame.params || {}
                if (event.type === 'message.start') relay.running.add(event.session_id)
                if (event.type === 'message.complete') relay.running.delete(event.session_id)
                void notify(event)
              }
            } catch { /* Preserve unknown protocol frames. */ }
            forwarded.push(line)
          }
          if (relay.client?.readyState === WebSocket.OPEN && forwarded.length) {
            if (relay.client.bufferedAmount > 4 * 1024 * 1024) relay.client.close(1013, 'Reconnect to catch up')
            else relay.client.send(forwarded.join('\n'))
          }
        })
        upstream.on('error', () => { socket.destroy(); relay.close() })
        upstream.on('close', () => { socket.destroy(); relay.client?.close(1012, 'Gateway disconnected'); relays.delete(relay) })
      } catch { socket.destroy() }
    })
  }
  return { handle, attach, close() { clearInterval(timer); for (const relay of relays) relay.close(); sockets.close(); devices.clear() } }
}
