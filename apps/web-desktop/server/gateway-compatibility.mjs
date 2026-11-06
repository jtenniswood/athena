import { randomBytes } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import { requestOrigin } from './identity.mjs'

const root = '/api/athena/gateway/'
const paths = { gateway: '/api/ws', 'speak-stream': '/api/audio/speak-stream', 'transcribe-stream': '/api/audio/transcribe-stream' }
const maxPayload = 384 * 1024 * 1024

/** Authenticate with Hermes itself; adapt only the browser-facing socket boundary. */
export function createGatewayCompatibility({ target, now = Date.now, fetch: request = globalThis.fetch }) {
  const tickets = new Map(), relays = new Set()
  const sockets = new WebSocketServer({ noServer: true, maxPayload, handleProtocols: () => false })
  let closed = false
  const scope = url => {
    const socket = url.searchParams.get('socket') || 'gateway'
    const profile = url.searchParams.get('profile') || ''
    if (!Object.hasOwn(paths, socket) || profile.length > 256 || /[\r\n\0]/.test(profile)) throw new Error('Invalid socket scope')
    return { socket, profile }
  }
  const prune = () => { for (const [key, value] of tickets) if (value.expires <= now()) tickets.delete(key) }
  const cleanup = setInterval(prune, 30000)
  cleanup.unref()
  const consumeTokenTicket = (url, origin) => {
    const handle = url.searchParams.get('athena_token_ticket')
    if (!handle) return undefined
    const selected = scope(url)
    prune()
    const saved = tickets.get(handle)
    tickets.delete(handle)
    if (closed || !saved || saved.origin !== origin || saved.socket !== selected.socket || saved.profile !== selected.profile) throw new Error('Invalid ticket')
    return saved.token
  }
  return {
    consumeTokenTicket,
    async handle(req, res) {
      const url = new URL(req.url, 'http://local.invalid')
      if (url.pathname !== root + 'token-ticket') return false
      const send = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify(body))
      }
      if (closed) { send(503, { error: 'Gateway transport is closing' }); return true }
      if (req.method !== 'POST') { send(405, { error: 'Method not allowed' }); return true }
      if (req.headers.origin !== requestOrigin(req)) { send(403, { error: 'Same-origin requests are required' }); return true }
      const token = req.headers['x-hermes-session-token']
      if (typeof token !== 'string' || !token || token.length > 8192) { send(401, { error: 'A session token is required' }); return true }
      let selected
      try { selected = scope(url) }
      catch { send(400, { error: 'Invalid socket scope' }); return true }
      try {
        const verified = await request(target + '/api/profiles', {
          headers: { 'X-Hermes-Session-Token': token }, redirect: 'manual', signal: AbortSignal.timeout(6000)
        })
        await verified.body?.cancel()
        if (closed) { send(503, { error: 'Gateway transport is closing' }); return true }
        if (verified.status !== 200) {
          send([401, 403].includes(verified.status) ? 401 : 502, { error: 'Hermes could not verify the session token' })
          return true
        }
        prune()
        if (tickets.size >= 512) { send(429, { error: 'Too many pending connection tickets' }); return true }
        const ticket = randomBytes(32).toString('base64url')
        tickets.set(ticket, { ...selected, token, origin: requestOrigin(req), expires: now() + 30000 })
        // Hermes verifies the credential again when the handle opens its upstream socket.
        send(200, { ticket })
      } catch { send(502, { error: 'Hermes could not verify the session token' }) }
      return true
    },
    attach(server) {
      server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, 'http://local.invalid')
        if (url.pathname !== root + 'ws') return
        const refuse = status => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
        if (closed || req.headers.origin !== requestOrigin(req)) { refuse('403 Forbidden'); return }
        try {
          const selected = scope(url)
          const upstreamUrl = new URL(target + paths[selected.socket])
          upstreamUrl.protocol = upstreamUrl.protocol === 'https:' ? 'wss:' : 'ws:'
          if (selected.profile) upstreamUrl.searchParams.set('profile', selected.profile)
          const token = consumeTokenTicket(url, requestOrigin(req))
          if (token) {
            upstreamUrl.searchParams.set('token', token)
          } else {
            const ticket = url.searchParams.get('ticket')
            if (!ticket || ticket.length > 8192) throw new Error('Missing ticket')
            upstreamUrl.searchParams.set('ticket', ticket)
          }
          // Validate the browser's origin above, then present this fixed proxy hop's
          // origin to Hermes. A standard serve need not know Athena's public hostname.
          const upstream = new WebSocket(upstreamUrl, {
            headers: { Origin: target, Cookie: req.headers.cookie || '' }, handshakeTimeout: 10000, maxPayload
          })
          let client
          const relay = { close() { upstream.terminate(); client?.terminate(); relays.delete(relay) } }
          relays.add(relay)
          socket.once('close', () => { if (!client) relay.close() })
          upstream.on('open', () => {
            if (socket.destroyed || closed) { relay.close(); return }
            sockets.handleUpgrade(req, socket, head, connected => {
              client = connected
              client.on('message', (data, binary) => { if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary }) })
              client.on('close', () => { upstream.close(); relays.delete(relay) })
              client.on('error', () => relay.close())
            })
          })
          upstream.on('message', (data, binary) => {
            if (client?.readyState !== WebSocket.OPEN) return
            if (client.bufferedAmount > 16 * 1024 * 1024) client.close(1013, 'Reconnect to catch up')
            else client.send(data, { binary })
          })
          upstream.on('close', code => {
            if (client) client.close([1005, 1006, 1015].includes(code) ? 1012 : code, 'Hermes connection closed')
            else socket.destroy()
            relays.delete(relay)
          })
          upstream.on('error', () => { socket.destroy(); relay.close() })
        } catch { refuse('401 Unauthorized') }
      })
    },
    close() { closed = true; clearInterval(cleanup); tickets.clear(); for (const relay of relays) relay.close(); sockets.close() }
  }
}
