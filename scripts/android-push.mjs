import { createAndroidPushStore } from './android-push-store.mjs'
import { createHash } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'

const root = '/api/athena/android/'
const retentionMs = 24 * 60 * 60 * 1000

/** Retain the authenticated gateway transport while Android suspends its WebView.
 * This forwards Hermes's own RPC protocol and stores no conversation history. */
export function createAndroidPush({ target, sender, fetch: request = globalThis.fetch, now = Date.now, directory }) {
  const store = createAndroidPushStore(directory), relays = new Set()
  let closed = false, pumping
  const removeDevice = (state, key) => {
    state.devices.delete(key)
    for (const [id, event] of state.events) if (event.key === key) state.events.delete(id)
  }
  async function drain() {
    if (closed || pumping) return pumping
    pumping = (async () => {
      for (const [id, event] of store.events) {
        if (closed) break
        if (event.expires <= now()) {
          if (event.status === 'pending') store.update(state => Object.assign(state.events.get(id), { status: 'expired', updated: now() }))
          continue
        }
        if (event.status !== 'pending' || event.nextAttempt > now()) continue
        const device = store.devices.get(event.key)
        if (!device?.enabled || !device.kinds[event.data.kind] || device.bindingId !== event.bindingId) {
          store.update(state => state.events.delete(id)); continue
        }
        const attempts = event.attempts + 1
        store.update(state => Object.assign(state.events.get(id), {
          attempts, updated: now(), nextAttempt: now() + Math.min(60000, 1000 * 2 ** (attempts - 1))
        }))
        let delivered = false
        try { await sender.send(device.token, event.data, device.activeUntil > now() ? 'NORMAL' : 'HIGH'); delivered = true }
        catch { /* Keep the durable event for the next bounded retry. Never log device credentials. */ }
        store.update(state => {
          const current = state.events.get(id)
          if (current) Object.assign(current, { status: delivered ? 'accepted' : attempts >= 12 ? 'failed' : 'pending', updated: now() })
        })
      }
    })().finally(() => { pumping = undefined })
    return pumping
  }
  const deliver = () => { void drain().catch(() => console.error('Athena Android push storage or delivery processing failed')) }
  const deliveryTimer = setInterval(deliver, 1000)
  deliveryTimer.unref()
  queueMicrotask(deliver)
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
    const stale = [...store.devices].filter(([, device]) => now() - device.updated > retentionMs).map(([key]) => key)
    const expired = [...store.events].filter(([, event]) => event.expires <= now()).map(([id]) => id)
    if (stale.length || expired.length) store.update(state => {
      for (const key of stale) removeDevice(state, key)
      for (const id of expired) state.events.delete(id)
    })
    for (const relay of relays) if (!relay.client && now() - relay.detached > (relay.running.size ? retentionMs : 60000)) relay.close()
  }
  const timer = setInterval(() => {
    try { prune() } catch { console.error('Athena Android push storage maintenance failed') }
    for (const relay of relays) if (relay.upstream.readyState === WebSocket.OPEN) {
      relay.upstream.send(JSON.stringify({ jsonrpc: '2.0', id: '__athena_push_ping', method: 'gateway.ping', params: {} }))
    }
  }, 15000)
  timer.unref()

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local.invalid')
    if (![root + 'push', root + 'push/token'].includes(url.pathname)) return false
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)) }
    if (!sender.enabled) return json(503, { error: 'Firebase push is not configured' }), true
    if (req.method !== 'GET' && (!['POST', 'DELETE'].includes(req.method) || req.headers.origin !== requestOrigin(req) || !req.headers['content-type']?.startsWith('application/json'))) return json(403, { error: 'Same-origin JSON request required' }), true
    try {
      let body = {}
      if (req.method !== 'GET') {
        let raw = ''
        for await (const chunk of req) { raw += chunk; if (raw.length > 8192) throw new Error('Request too large') }
        body = JSON.parse(raw)
      }
      const tokenVersion = body.tokenVersion ?? 0
      if (!Number.isSafeInteger(tokenVersion) || tokenVersion < 0) throw new Error('Invalid token version')
      if (url.pathname === root + 'push/token') {
        if (req.method !== 'POST' || !/^[A-Za-z0-9_-]{43}$/.test(body.refreshKey) ||
            typeof body.token !== 'string' || body.token.length < 20 || body.token.length > 4096) throw new Error('Invalid refresh')
        const match = [...store.devices].find(([, device]) => device.deviceId === body.deviceId &&
          device.bindingId === body.bindingId && device.origin === requestOrigin(req))
        const [key, device] = match || []
        if (!device?.enabled || now() - device.updated > retentionMs ||
            device.refreshHash !== createHash('sha256').update(body.refreshKey).digest('hex')) throw new Error('Invalid refresh')
        if (tokenVersion < (device.tokenVersion || 0) ||
            (tokenVersion > 0 && tokenVersion === device.tokenVersion && body.token !== device.token)) {
          json(409, { error: 'A newer token is already registered' }); return true
        }
        store.update(state => Object.assign(state.devices.get(key), { token: body.token, tokenVersion, tokenUpdated: now() }))
        json(200, { ok: true }); deliver(); return true
      }
      const authenticated = await identity(req)
      const account = authenticated.id
      if (authenticated.cookies.length) res.setHeader('Set-Cookie', authenticated.cookies)
      if (req.method === 'GET') {
        const key = keyFor(account, url.searchParams.get('device'))
        const device = store.devices.get(key)
        const events = [...store.events.values()].filter(event => event.key === key)
        const latest = events.sort((a, b) => b.created - a.created)[0]
        json(200, { registered: Boolean(device?.enabled), persistent: Boolean(directory),
          relayConnected: [...relays].some(relay => relay.key === key && relay.upstream.readyState === WebSocket.OPEN),
          pending: events.filter(event => event.status === 'pending').length,
          lastDelivery: latest ? { state: latest.status, attempts: latest.attempts, updated: latest.updated } : null })
        return true
      }
      if (!/^[a-f0-9-]{36}$/.test(body.deviceId)) throw new Error('Invalid device')
      const key = keyFor(account, body.deviceId)
      if (req.method === 'DELETE') {
        store.update(state => removeDevice(state, key))
        for (const relay of relays) if (relay.key === key) relay.close()
      } else {
        if (typeof body.token !== 'string' || body.token.length < 20 || body.token.length > 4096) throw new Error('Invalid push token')
        if (!/^[a-f0-9-]{36}$/.test(body.bindingId)) throw new Error('Invalid binding')
        if (body.accountScopedBinding === true) body.bindingId = createHash('sha256').update(JSON.stringify([account, body.bindingId])).digest('hex')
        prune()
        if (!store.devices.has(key) && store.devices.size >= 500) throw new Error('Too many devices')
        // One installation belongs to the currently signed-in account only.
        for (const [other, device] of store.devices) if (other !== key && device.deviceId === body.deviceId) {
          store.update(state => removeDevice(state, other))
          for (const relay of relays) if (relay.key === other) relay.close()
        }
        const kinds = Object.fromEntries(['turnDone', 'turnError', 'approval', 'input'].map(kind => [kind, body.kinds?.[kind] !== false]))
        store.update(state => {
          const old = state.devices.get(key)
          if (old && (old.bindingId !== body.bindingId || body.enabled !== true)) removeDevice(state, key)
          const keepToken = body.tokenVersion != null && old?.bindingId === body.bindingId && (tokenVersion < (old.tokenVersion || 0) ||
            (tokenVersion > 0 && tokenVersion === old.tokenVersion && body.token !== old.token))
          state.devices.set(key, { deviceId: body.deviceId, token: keepToken ? old.token : body.token,
            tokenVersion: keepToken ? old.tokenVersion : tokenVersion, bindingId: body.bindingId, enabled: body.enabled === true, kinds,
            refreshHash: body.tokenVersion != null && typeof body.refreshKey === 'string' && /^[A-Za-z0-9_-]{43}$/.test(body.refreshKey)
              ? createHash('sha256').update(body.refreshKey).digest('hex') : null,
            origin: requestOrigin(req), activeUntil: body.foreground === true ? now() + 45000 : 0, updated: now() })
        })
      }
      json(200, { ok: true, bindingId: body.bindingId })
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
        const device = store.devices.get(key)
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
          const current = store.devices.get(key)
          if (!current?.enabled || event.type !== 'message.complete' || ['interrupted', 'cancelled'].includes(event.payload?.status)) return
          const sessionId = relay.sessions.get(event.session_id) || event.session_id
          if (typeof sessionId !== 'string' || !sessionId) return
          const kind = event.payload?.status === 'error' ? 'turnError' : 'turnDone'
          if (!kind || !current.kinds[kind]) return
          const eventKey = `${sessionId}:${event.replay_epoch || ''}:${event.seq ?? event.payload?.persisted_turn?.submission_id ?? Math.floor(now() / 1000)}`
          const id = createHash('sha256').update(JSON.stringify([key, current.bindingId, eventKey])).digest('hex')
          if (store.events.has(id)) return
          const data = { eventId: id, expiresAt: String(now() + 3600000), kind, origin: current.origin, bindingId: current.bindingId, focusSessionId: sessionId, tag: `android:${sessionId}`,
            title: kind === 'turnDone' ? 'Athena · Response ready' : kind === 'turnError' ? 'Athena · Response failed' : 'Athena · Attention needed',
            body: kind === 'turnDone' ? 'Your response is ready.' : 'Open Athena to view this conversation.' }
          store.update(state => state.events.set(id, { key, bindingId: current.bindingId, data,
            status: 'pending', attempts: 0, created: now(), updated: now(), nextAttempt: now(), expires: now() + 3600000 }))
          deliver()
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
                void notify(event).catch(() => console.error('Athena Android push event could not be persisted'))
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
  return { handle, attach, drain, close() { closed = true; clearInterval(deliveryTimer); clearInterval(timer); for (const relay of relays) relay.close(); sockets.close() } }
}
