import { createAndroidPushStore } from './android-push-store.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { notificationChatTitle, notificationSnippet } from './android-notification-content.mjs'
import { WebSocket, WebSocketServer } from 'ws'
import { accountIdentity, probeIdentity, requestOrigin } from './identity.mjs'

const root = '/api/athena/android/'
const retentionMs = 24 * 60 * 60 * 1000
const titleRetryMs = [0, 1000, 2000, 4000, 8000, 15000, 30000, 60000]
const creditNotices = new Set(['credits.depleted', 'credits.window_limit', 'credits.restored'])
const inputRequests = new Set(['clarify', 'sudo', 'secret', 'vault.code', 'vault.unlock', 'vault.save_login', 'display.install.sudo'])

function describeAlert(type, payload) {
  if (type === 'message.complete') {
    if (payload.status === 'interrupted' || payload.status === 'cancelled') return
    if (payload.status !== 'error') return {
      kind: 'turnDone', title: 'Athena · Response ready', body: notificationSnippet(payload.text) || 'Your response is ready.'
    }
  }
  if (type === 'message.complete' || type === 'error') return {
    kind: 'turnError', title: 'Athena · Response failed',
    body: notificationSnippet(payload.message || payload.error || payload.text) || 'Open Athena to see what happened.'
  }
  if (type === 'approval.request' || type === 'approval') return {
    kind: 'approval', title: 'Athena · Approval needed', body: 'Open the conversation to review the request.'
  }
  if (type === 'clarify.request' || inputRequests.has(type)) return {
    kind: 'input', title: 'Athena · Input needed', body: 'Open Athena to respond to the request.'
  }
  if (type === 'notification.show') {
    const credits = creditNotices.has(payload.key)
    if (credits || ['warn', 'error'].includes(payload.level)) return {
      kind: credits ? 'credits' : 'turnError', title: 'Athena · System alert',
      body: notificationSnippet(payload.text) || 'Open Athena to view the alert.'
    }
  }
}

/** Retain the authenticated gateway transport while Android suspends its WebView.
 * This forwards Hermes's own RPC protocol and stores no conversation history. */
export function createAndroidPush({ target, identityUrl = target, sender, fetch: request = globalThis.fetch, now = Date.now, directory, consumeTokenTicket }) {
  const store = createAndroidPushStore(directory), relays = new Set()
  const titleLookups = new Set(), shutdown = new AbortController()
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
          if (event.status === 'pending') store.update(state => {
            const current = state.events.get(id)
            Object.assign(current, { status: 'expired', updated: now() })
            delete current.preview
          })
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
          if (!current) return
          Object.assign(current, { status: delivered ? 'accepted' : attempts >= 12 ? 'failed' : 'pending', updated: now() })
          if (current.status === 'failed') delete current.preview
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
    const response = await probeIdentity(target, headers, request)
    if (!response.ok) throw new Error('Sign in required')
    return { id: accountIdentity(identityUrl, await response.json()),
      cookies: response.headers.getSetCookie() }
  }
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
    if (![root + 'push', root + 'push/token', root + 'push/test', root + 'push/preview'].includes(url.pathname)) return false
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
      if (url.pathname === root + 'push/preview') {
        if (req.method !== 'POST' || typeof body.previewKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.previewKey) ||
            typeof body.eventId !== 'string' || !/^[a-f0-9]{64}$/.test(body.eventId)) {
          json(400, { error: 'Invalid notification preview request' })
          return true
        }
        const event = store.events.get(body.eventId)
        const device = event && store.devices.get(event.key)
        const previewHash = createHash('sha256').update(body.previewKey).digest('hex')
        if (!event?.preview || event.expires <= now() || !device?.enabled || !device.kinds[event.data.kind] ||
            event.bindingId !== device.bindingId || device.bindingId !== body.bindingId || device.origin !== requestOrigin(req) ||
            device.previewHash !== previewHash || event.previewHash !== previewHash) {
          json(404, { error: 'Notification preview unavailable' })
          return true
        }
        json(200, event.preview)
        return true
      }
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
      if (url.pathname === root + 'push/test') {
        const key = keyFor(account, body.deviceId)
        const device = store.devices.get(key)
        if (req.method !== 'POST' || !device?.enabled || device.origin !== requestOrigin(req) || now() - device.updated > retentionMs) {
          return json(409, { error: 'Enable background delivery on this device first.' }), true
        }
        if (device.lastTest != null && now() - device.lastTest < 15000) {
          return json(429, { error: 'Wait 15 seconds before testing again.' }), true
        }
        store.update(state => { state.devices.get(key).lastTest = now() })
        try {
          await sender.send(device.token, {
            eventId: randomUUID(), expiresAt: String(now() + 60000), kind: 'test',
            origin: device.origin, bindingId: device.bindingId, tag: 'android:push-test',
            title: 'Athena · Push test', body: 'Your Athena server sent this notification through Firebase.'
          }, 'HIGH')
          json(200, { ok: true })
        } catch { json(502, { error: 'Firebase could not accept the test notification.' }) }
        return true
      }
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
        const kinds = Object.fromEntries(['turnDone', 'turnError', 'approval', 'input', 'credits'].map(kind => [kind, body.kinds?.[kind] !== false]))
        store.update(state => {
          const old = state.devices.get(key)
          if (old && (old.bindingId !== body.bindingId || body.enabled !== true)) removeDevice(state, key)
          const keepToken = body.tokenVersion != null && old?.bindingId === body.bindingId && (tokenVersion < (old.tokenVersion || 0) ||
            (tokenVersion > 0 && tokenVersion === old.tokenVersion && body.token !== old.token))
          state.devices.set(key, { deviceId: body.deviceId, token: keepToken ? old.token : body.token,
            tokenVersion: keepToken ? old.tokenVersion : tokenVersion, bindingId: body.bindingId, enabled: body.enabled === true, kinds,
            refreshHash: body.tokenVersion != null && typeof body.refreshKey === 'string' && /^[A-Za-z0-9_-]{43}$/.test(body.refreshKey)
              ? createHash('sha256').update(body.refreshKey).digest('hex') : null,
            lastTest: old?.lastTest,
            previewHash: typeof body.previewKey === 'string' && /^[A-Za-z0-9_-]{43}$/.test(body.previewKey)
              ? createHash('sha256').update(body.previewKey).digest('hex') : null,
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
      if (closed) { socket.destroy(); return }
      if (req.headers.origin !== requestOrigin(req) || !sender.enabled) { socket.destroy(); return }
      try {
        // A standard-server handle is shared with the foreground relay and consumed
        // once, before verifying this device's Hermes account as usual.
        if (url.searchParams.has('athena_token_ticket')) {
          if ((url.searchParams.get('socket') || 'gateway') !== 'gateway') throw new Error('Invalid socket scope')
          const token = consumeTokenTicket?.(url, requestOrigin(req))
          if (!token) throw new Error('Invalid ticket')
          req.headers['x-hermes-session-token'] = token
          url.searchParams.delete('athena_token_ticket')
          url.searchParams.delete('ticket')
          url.searchParams.set('token', token)
        }
        const authenticated = await identity(req), account = authenticated.id, deviceId = url.searchParams.get('device')
        if (closed) { socket.destroy(); return }
        req[refreshedCookies] = authenticated.cookies
        const key = keyFor(account, deviceId)
        const device = store.devices.get(key)
        if (!device || device.origin !== requestOrigin(req)) throw new Error('Register device first')
        if ([...relays].filter(relay => relay.key === key).length >= 8) throw new Error('Too many connections')
        url.searchParams.delete('device')
        url.searchParams.delete('socket')
        const upstreamUrl = new URL(target + '/api/ws')
        upstreamUrl.protocol = upstreamUrl.protocol === 'https:' ? 'wss:' : 'ws:'
        upstreamUrl.search = url.search
        const protocols = String(req.headers['sec-websocket-protocol'] || '').split(',').map(value => value.trim()).filter(Boolean)
        const upstream = new WebSocket(upstreamUrl, protocols, { headers: { Cookie: req.headers.cookie || '', Origin: target,
          'X-Forwarded-Host': req.headers['x-forwarded-host'] || req.headers.host,
          'X-Forwarded-Proto': req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http') },
          handshakeTimeout: 10000, maxPayload: 8 * 1024 * 1024 })
        const relay = { key, upstream, client: null, detached: now(), sessions: new Map(), pending: new Map(), running: new Set(),
          close() { upstream.terminate(); relay.client?.terminate(); relays.delete(relay) } }
        relays.add(relay)
        const profileOnSocket = url.searchParams.get('profile')
        const authHeaders = {
          Cookie: req.headers.cookie || '',
          'X-Hermes-Session-Token': url.searchParams.get('token') || req.headers['x-hermes-session-token'] || '',
          'X-Forwarded-Host': req.headers['x-forwarded-host'] || req.headers.host,
          'X-Forwarded-Proto': req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')
        }
        async function readTitle(runtimeId, sessionId, profile, eligible) {
          const lookup = new URL(target + '/api/sessions/' + encodeURIComponent(sessionId))
          if (profile) lookup.searchParams.set('profile', profile)
          for (const wait of titleRetryMs) {
            if (wait) await delay(wait, undefined, { ref: false, signal: shutdown.signal })
            if (!eligible()) return ''
            const known = relay.sessions.get(runtimeId)
            if (known?.id === sessionId && known.title) return known.title
            try {
              const response = await request(lookup.href, { headers: authHeaders, redirect: 'manual',
                signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(4000)]) })
              if (response.ok) {
                const title = notificationChatTitle((await response.json()).title)
                if (title) return title
              }
            } catch { /* A title can be persisted after the completion frame. */ }
          }
          return ''
        }
        const notify = async event => {
          const current = store.devices.get(key)
          if (!current?.enabled) return
          const payload = event.payload || {}
          const session = relay.sessions.get(event.session_id)
          const system = event.type === 'notification.show'
          const storedId = session?.id || event.session_id
          const sessionId = !system && typeof storedId === 'string' ? storedId : ''
          const profile = session?.profile || profileOnSocket
          const promptId = payload.prompt_id || payload.request_id
          if ((event.type === 'approval.settled' || event.type === 'clarify.settled') && promptId) {
            const pending = [...store.events].filter(([, queued]) => queued.key === key &&
              queued.status === 'pending' && queued.promptId === promptId && queued.data.focusSessionId === sessionId &&
              (queued.data.focusProfile || null) === (profile || null))
            if (pending.length) store.update(state => {
              for (const [id] of pending) state.events.delete(id)
            })
            return
          }
          const alert = describeAlert(event.type, payload)
          if (!alert || !current.kinds[alert.kind] || (alert.kind === 'turnDone' && !sessionId)) return
          const eventKey = promptId ?? payload.persisted_turn?.submission_id ?? event.seq ?? event.rpcId ?? Math.floor(now() / 1000)
          const id = createHash('sha256').update(JSON.stringify([
            key, current.bindingId, profile, sessionId, event.type, event.replay_epoch || '', eventKey
          ])).digest('hex')
          if (store.events.has(id) || titleLookups.has(id)) return
          const eligible = () => {
            const registered = store.devices.get(key)
            return !closed && registered?.bindingId === current.bindingId && registered.enabled && registered.kinds[alert.kind]
          }
          let chatTitle
          if (alert.kind === 'turnDone') {
            titleLookups.add(id)
            try { chatTitle = await readTitle(event.session_id, sessionId, profile, eligible) }
            finally { titleLookups.delete(id) }
            if (!chatTitle) return
          }
          if (!eligible() || store.events.has(id)) return
          const timestamp = now()
          const expires = timestamp + (['approval', 'input'].includes(alert.kind) ? 300000 : 3600000)
          const tag = alert.kind === 'turnDone' ? 'android:' + sessionId
            : 'android:' + alert.kind + ':' + (sessionId || 'system')
          const data = { eventId: id, expiresAt: String(expires), origin: current.origin, bindingId: current.bindingId,
            kind: alert.kind, title: alert.title, tag,
            body: alert.kind === 'turnDone' ? 'Your response is ready.' : ['approval', 'input'].includes(alert.kind) ? alert.body : 'Open Athena to view the alert.',
            ...(sessionId ? { focusSessionId: sessionId } : {}),
            ...(sessionId && profile ? { focusProfile: profile } : {}) }
          const previewHash = store.devices.get(key)?.previewHash
          const preview = previewHash && (chatTitle || alert.body !== data.body) ? { chatTitle, body: alert.body } : undefined
          if (preview) data.fetchPreview = 'true'
          store.update(state => state.events.set(id, { key, bindingId: current.bindingId, data, preview,
            previewHash: preview ? previewHash : undefined, promptId,
            status: 'pending', attempts: 0, created: timestamp, updated: timestamp, nextAttempt: timestamp, expires }))
          deliver()
        }
        const handleAlert = event => {
          void notify(event).catch(() => {
            if (!closed) console.error('Athena Android push event could not be persisted')
          })
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
                  if (['session.resume', 'session.create', 'session.activate'].includes(frame.method) && frame.id != null) {
                    relay.pending.set(frame.id, { id: frame.method === 'session.activate' ? undefined : frame.params?.session_id,
                      profile: frame.params?.profile })
                  }
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
              if (frame.result?.session_id && relay.pending.has(frame.id)) {
                const pending = relay.pending.get(frame.id)
                const previous = relay.sessions.get(frame.result.session_id)
                const id = frame.result.stored_session_id || pending?.id || previous?.id || frame.result.session_id
                const profile = typeof pending?.profile === 'string' && pending.profile || previous?.profile || url.searchParams.get('profile')
                const title = notificationChatTitle(frame.result.info?.title || frame.result.title)
                relay.sessions.set(frame.result.session_id, { id, profile, title: title || previous?.title })
                if (frame.result.running === true) relay.running.add(frame.result.session_id)
              }
              if (frame.id != null) relay.pending.delete(frame.id)
              if (frame.method === 'event') {
                const event = frame.params || {}
                if (event.type === 'message.start') relay.running.add(event.session_id)
                if (event.type === 'message.complete') relay.running.delete(event.session_id)
                if (event.type === 'session.title' || event.type === 'session.updated' || event.type === 'session.info') {
                  const runtimeId = event.session_id
                  const title = notificationChatTitle(event.payload?.title)
                  if (runtimeId && title) {
                    const session = relay.sessions.get(runtimeId)
                    relay.sessions.set(runtimeId, { id: session?.id || event.payload?.session_id || runtimeId,
                      profile: session?.profile || profileOnSocket, title })
                  }
                }
                handleAlert(event)
              } else if (frame.id != null && typeof frame.method === 'string') {
                handleAlert({ type: frame.method, session_id: frame.params?.session_id, payload: frame.params, rpcId: frame.id })
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
  return { handle, attach, drain, close() { closed = true; shutdown.abort(); clearInterval(deliveryTimer); clearInterval(timer); for (const relay of relays) relay.close(); sockets.close() } }
}
