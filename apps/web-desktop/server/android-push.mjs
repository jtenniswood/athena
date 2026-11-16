import { createAndroidPushStore } from './android-push-store.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { notificationChatTitle, notificationSnippet } from './android-notification-content.mjs'
import { WebSocket, WebSocketServer } from 'ws'
import { accountIdentity, probeIdentity, requestOrigin } from './identity.mjs'
import { browserSubscription } from './browser-push.mjs'
import { replyLifetimeMs, replyNotificationHeaders, scanRecentReplies } from './reply-notifications.mjs'

const root = '/api/athena/android/'
const browserRoot = '/api/athena/browser/push'
const retentionMs = 24 * 60 * 60 * 1000
const titleRetryMs = [0, 1000, 2000]
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
export function createAndroidPush({ target, identityUrl = target, sender, fetch: request = globalThis.fetch, now = Date.now, directory, browserSender, consumeTokenTicket }) {
  const store = createAndroidPushStore(directory), relays = new Set()
  const titleLookups = new Set(), shutdown = new AbortController()
  const watches = new Map()
  let closed = false, pumping, scanning
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
        if (device.subscription && !browserSender?.enabled) continue
        const attempts = event.attempts + 1
        store.update(state => Object.assign(state.events.get(id), {
          attempts, updated: now(), nextAttempt: now() + Math.min(60000, 1000 * 2 ** (attempts - 1))
        }))
        let delivered = false
        try {
          if (device.subscription) {
            await browserSender.send(device.subscription, event.data, Math.ceil((event.expires - now()) / 1000))
          } else {
            const foreground = device.activeUntil > now() && [...relays].some(relay => relay.key === event.key && relay.client)
            await sender.send(device.token, event.data, foreground && !event.background ? 'NORMAL' : 'HIGH')
          }
          delivered = true
        } catch (error) {
          if (device.subscription && [404, 410].includes(error.statusCode) &&
              store.devices.get(event.key)?.subscription?.endpoint === device.subscription.endpoint) {
            unregister(event.key)
          }
          // Keep transient failures in the durable queue for the next retry.
        }
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
  const deliver = () => { void drain().catch(() => console.error('Athena push storage or delivery processing failed')) }
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
    return { id: accountIdentity(identityUrl, await response.json()), cookies: response.headers.getSetCookie() }
  }
  const keyFor = (account, deviceId) => `${account}:${deviceId}`
  const unregister = key => {
    watches.delete(key)
    store.update(state => removeDevice(state, key))
    for (const relay of relays) if (relay.key === key) relay.close()
  }
  function watchReplies(key, req, cookies) {
    const device = store.devices.get(key)
    if (!device?.enabled || !device.kinds.turnDone) {
      watches.delete(key)
      return
    }
    const headers = replyNotificationHeaders(req, device.origin, cookies)
    if (!headers.cookie && !headers['x-hermes-session-token']) {
      watches.delete(key)
      return
    }
    const previous = watches.get(key)
    const same = previous?.bindingId === device.bindingId && previous.since === device.repliesSince
    const watch = same ? previous : { bindingId: device.bindingId, since: device.repliesSince, inspected: new Map() }
    watch.headers = headers
    watches.set(key, watch)
  }
  function enqueue({ key, bindingId, id, alert, sessionId, profile, chatTitle, promptId, background = false, completedAt = now() }) {
    const current = store.devices.get(key)
    if (closed || !current?.enabled || current.bindingId !== bindingId || !current.kinds[alert.kind] || store.events.has(id)) return
    const timestamp = now()
    const expires = completedAt + (['approval', 'input'].includes(alert.kind) ? 300000 : replyLifetimeMs)
    if (expires <= timestamp) return
    const tag = alert.kind === 'turnDone' ? 'android:' + sessionId : 'android:' + alert.kind + ':' + (sessionId || 'system')
    const data = { eventId: id, expiresAt: String(expires), origin: current.origin, bindingId,
      kind: alert.kind, title: alert.title,
      tag: current.subscription && sessionId ? JSON.stringify([profile, sessionId]) : tag,
      body: alert.kind === 'turnDone' ? 'Your response is ready.' : ['approval', 'input'].includes(alert.kind) ? alert.body : 'Open Athena to view the alert.',
      ...(sessionId ? { focusSessionId: sessionId } : {}),
      ...(sessionId && profile ? { focusProfile: profile } : {}),
      ...(current.silent ? { silent: 'true' } : {}) }
    const preview = current.previewHash && (chatTitle || alert.body !== data.body) ? { chatTitle, body: alert.body } : undefined
    if (preview) data.fetchPreview = 'true'
    store.update(state => state.events.set(id, { key, bindingId, data, preview, background,
      previewHash: preview ? current.previewHash : undefined, promptId,
      status: 'pending', attempts: 0, created: timestamp, updated: timestamp, nextAttempt: timestamp, expires }))
    deliver()
  }
  const androidReplyId = (key, bindingId, profile, sessionId) =>
    createHash('sha256').update(JSON.stringify([key, bindingId, profile || 'default', sessionId, 'reply'])).digest('hex')
  function scanReplies() {
    if (closed || scanning) return scanning
    scanning = (async () => {
      for (const [key, watch] of watches) {
        const device = store.devices.get(key)
        if (closed) break
        if (!device?.enabled || !device.kinds.turnDone || now() - device.updated > retentionMs) continue
        const headers = watch.headers
        const since = Math.max(watch.since, now() - replyLifetimeMs)
        try {
          const authenticated = await scanRecentReplies({
            target, headers, request, since, signal: shutdown.signal,
            shouldInspect: row => {
              if (watches.get(key) !== watch) return false
              const owner = JSON.stringify([row.profile, row.id])
              const revision = JSON.stringify([row.message_count, row.last_active, row.last_read_at, row.end_reason])
              return watch.inspected.get(owner) !== revision
            },
            onInspected(row) {
              if (watch.inspected.size >= 1000) watch.inspected.clear()
              watch.inspected.set(JSON.stringify([row.profile, row.id]),
                JSON.stringify([row.message_count, row.last_active, row.last_read_at, row.end_reason]))
            },
            onReply(row, reply) {
              if (watches.get(key) !== watch) return
              const registered = store.devices.get(key)
              const aliases = Array.isArray(row._lineage_ids) ? row._lineage_ids : []
              if (registered?.subscription && registered.activeUntil > now() &&
                  (!registered.visibleProfile || registered.visibleProfile === row.profile) &&
                  [row.id, row._lineage_root_id, ...aliases].includes(registered.visibleSession)) return
              const sessionId = row._lineage_root_id || row.id
              const id = device.subscription
                ? createHash('sha256').update(JSON.stringify([key, watch.bindingId, row.profile, sessionId, reply.replyId])).digest('hex')
                : androidReplyId(key, watch.bindingId, row.profile, sessionId)
              const alert = { kind: 'turnDone', title: 'Athena · Response ready', body: reply.body }
              enqueue({ key, bindingId: watch.bindingId, id, alert, sessionId, profile: row.profile,
                chatTitle: reply.chatTitle, background: true, completedAt: reply.timestamp })
            }
          })
          if (!authenticated && watches.get(key) === watch && watch.headers === headers) watches.delete(key)
        } catch { /* A transient gateway failure will be retried on the next scan. */ }
      }
    })().finally(() => { scanning = undefined })
    return scanning
  }
  const prune = () => {
    const stale = [...store.devices].filter(([, device]) => now() - device.updated > retentionMs).map(([key]) => key)
    const expired = [...store.events].filter(([, event]) => event.expires <= now()).map(([id]) => id)
    if (stale.length || expired.length) store.update(state => {
      for (const key of stale) removeDevice(state, key)
      for (const id of expired) state.events.delete(id)
    })
    for (const key of stale) watches.delete(key)
    for (const relay of relays) if (!relay.client && now() - relay.detached > (relay.running.size ? retentionMs : 60000)) relay.close()
  }
  const timer = setInterval(() => {
    try { prune() } catch { console.error('Athena push storage maintenance failed') }
    void scanReplies()
    for (const relay of relays) if (relay.upstream.readyState === WebSocket.OPEN) {
      relay.upstream.send(JSON.stringify({ jsonrpc: '2.0', id: '__athena_push_ping', method: 'gateway.ping', params: {} }))
    }
  }, 15000)
  timer.unref()

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local.invalid')
    if (url.pathname === browserRoot || url.pathname === browserRoot + '/test') return handleBrowser(req, res, url)
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
        const match = [...store.devices].find(([, device]) => !device.subscription && device.deviceId === body.deviceId &&
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
          watchingReplies: watches.has(key),
          relayConnected: [...relays].some(relay => relay.key === key && relay.upstream.readyState === WebSocket.OPEN),
          pending: events.filter(event => event.status === 'pending').length,
          lastDelivery: latest ? { state: latest.status, attempts: latest.attempts, updated: latest.updated } : null })
        return true
      }
      if (!/^[a-f0-9-]{36}$/.test(body.deviceId)) throw new Error('Invalid device')
      const key = keyFor(account, body.deviceId)
      if (req.method === 'DELETE') {
        unregister(key)
      } else {
        if (typeof body.token !== 'string' || body.token.length < 20 || body.token.length > 4096) throw new Error('Invalid push token')
        if (!/^[a-f0-9-]{36}$/.test(body.bindingId)) throw new Error('Invalid binding')
        if (body.accountScopedBinding === true) body.bindingId = createHash('sha256').update(JSON.stringify([account, body.bindingId])).digest('hex')
        prune()
        if (!store.devices.has(key) && store.devices.size >= 500) throw new Error('Too many devices')
        // One installation belongs to the currently signed-in account only.
        for (const [other, device] of store.devices) if (other !== key && !device.subscription && device.deviceId === body.deviceId) {
          unregister(other)
        }
        const kinds = Object.fromEntries(['turnDone', 'turnError', 'approval', 'input', 'credits'].map(kind => [kind, body.kinds?.[kind] !== false]))
        store.update(state => {
          const old = state.devices.get(key)
          if (old && (old.bindingId !== body.bindingId || body.enabled !== true)) removeDevice(state, key)
          const keepToken = body.tokenVersion != null && old?.bindingId === body.bindingId && (tokenVersion < (old.tokenVersion || 0) ||
            (tokenVersion > 0 && tokenVersion === old.tokenVersion && body.token !== old.token))
          state.devices.set(key, { deviceId: body.deviceId, token: keepToken ? old.token : body.token,
            tokenVersion: keepToken ? old.tokenVersion : tokenVersion, bindingId: body.bindingId, enabled: body.enabled === true, kinds, silent: body.silent === true,
            refreshHash: body.tokenVersion != null && typeof body.refreshKey === 'string' && /^[A-Za-z0-9_-]{43}$/.test(body.refreshKey)
              ? createHash('sha256').update(body.refreshKey).digest('hex') : null,
            lastTest: old?.lastTest,
            repliesSince: old?.enabled && old.bindingId === body.bindingId && old.kinds.turnDone && kinds.turnDone && old.repliesSince != null
              ? old.repliesSince : now(),
            previewHash: typeof body.previewKey === 'string' && /^[A-Za-z0-9_-]{43}$/.test(body.previewKey)
              ? createHash('sha256').update(body.previewKey).digest('hex') : null,
            origin: requestOrigin(req), activeUntil: body.foreground === true ? now() + 45000 : 0, updated: now() })
        })
        watchReplies(key, req, authenticated.cookies)
      }
      json(200, { ok: true, bindingId: body.bindingId })
    } catch { json(400, { error: 'Could not register Android push notifications' }) }
    return true
  }

  async function handleBrowser(req, res, url) {
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(data))
    }
    if (!browserSender?.enabled) return json(503, { error: 'Browser push storage is unavailable' }), true
    const origin = requestOrigin(req)
    const parsed = new URL(origin)
    if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
      return json(403, { error: 'Browser push requires HTTPS' }), true
    }
    if (req.method === 'GET' && url.pathname === browserRoot) {
      json(200, { publicKey: browserSender.publicKey() })
      return true
    }
    if (!['POST', 'DELETE'].includes(req.method) || req.headers.origin !== origin ||
        !req.headers['content-type']?.startsWith('application/json')) {
      return json(403, { error: 'Same-origin JSON request required' }), true
    }
    try {
      let raw = ''
      for await (const chunk of req) {
        raw += chunk
        if (raw.length > 8192) throw new Error('Request too large')
      }
      const body = JSON.parse(raw)
      if (!/^[a-f0-9-]{36}$/.test(body.deviceId)) throw new Error('Invalid installation')
      const authenticated = await identity(req)
      if (authenticated.cookies.length) res.setHeader('Set-Cookie', authenticated.cookies)
      const key = keyFor(authenticated.id, 'web:' + body.deviceId)
      const old = store.devices.get(key)
      if (url.pathname.endsWith('/test')) {
        if (req.method !== 'POST' || !old?.enabled || old.origin !== origin) return json(409, { error: 'Enable browser push first' }), true
        if (old.lastTest != null && now() - old.lastTest < 15000) return json(429, { error: 'Wait 15 seconds before testing again' }), true
        store.update(state => { state.devices.get(key).lastTest = now() })
        try {
          await browserSender.send(old.subscription, { origin, title: 'Athena · Push test', body: 'Your Athena server sent this notification.' }, 60)
        } catch (error) {
          if ([404, 410].includes(error.statusCode)) unregister(key)
          return json(502, { error: 'The browser push service could not accept the test.' }), true
        }
      } else if (req.method === 'DELETE') {
        if (old?.origin === origin) unregister(key)
      } else {
        const subscription = browserSubscription(body.subscription)
        if (!subscription || (old && old.origin !== origin)) throw new Error('Invalid subscription')
        prune()
        if (!store.devices.has(key) && store.devices.size >= 500) throw new Error('Too many installations')
        for (const [other, device] of store.devices) {
          if (other !== key && device.subscription &&
              (device.subscription.endpoint === subscription.endpoint || (device.origin === origin && device.deviceId === body.deviceId))) unregister(other)
        }
        const same = old?.subscription?.endpoint === subscription.endpoint
        const enabled = body.enabled === true
        store.update(state => {
          if (!same || !enabled) removeDevice(state, key)
          state.devices.set(key, { deviceId: body.deviceId, origin, subscription, enabled,
            bindingId: same ? old.bindingId : randomUUID(), kinds: { turnDone: true },
            visibleSession: typeof body.visibleSession === 'string' ? body.visibleSession.slice(0, 256) : null,
            visibleProfile: typeof body.visibleProfile === 'string' ? body.visibleProfile.slice(0, 128) : null,
            silent: body.silent === true,
            activeUntil: body.visibleSession ? now() + 45_000 : 0,
            lastTest: old?.lastTest, updated: now(), repliesSince: same && old.enabled ? old.repliesSince : now() })
        })
        watchReplies(key, req, authenticated.cookies)
        return json(200, { watchingReplies: watches.has(key) }), true
      }
      json(200, { ok: true })
    } catch { json(400, { error: 'Browser push request could not be completed' }) }
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
        const authHeaders = replyNotificationHeaders({
          headers: { ...req.headers, 'x-hermes-session-token': url.searchParams.get('token') || req.headers['x-hermes-session-token'] }
        }, requestOrigin(req), authenticated.cookies)
        async function readTitle(runtimeId, sessionId, profile, eligible) {
          const lookup = new URL(target + '/api/sessions/' + encodeURIComponent(sessionId))
          if (profile) lookup.searchParams.set('profile', profile)
          for (const wait of titleRetryMs) {
            if (wait) await delay(wait, undefined, { ref: false, signal: shutdown.signal })
            if (!eligible()) return ''
            const known = relay.sessions.get(runtimeId)
            if (known?.id === sessionId && known.title) return known.title
            try {
              const response = await request(lookup.href, { headers: watches.get(key)?.headers || authHeaders, redirect: 'manual',
                signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(1500)]) })
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
          if (!current?.enabled || current.bindingId !== device.bindingId) return
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
          const id = alert.kind === 'turnDone'
            ? androidReplyId(key, current.bindingId, profile, sessionId)
            : createHash('sha256').update(JSON.stringify([
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
          }
          if (!eligible() || store.events.has(id)) return
          enqueue({ key, bindingId: current.bindingId, id, alert, sessionId, profile, chatTitle, promptId })
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
  return { handle, attach, drain, scanReplies, close() { closed = true; shutdown.abort(); watches.clear(); clearInterval(deliveryTimer); clearInterval(timer); for (const relay of relays) relay.close(); sockets.close() } }
}
