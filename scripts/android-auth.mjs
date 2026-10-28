import { createHash, randomBytes } from 'node:crypto'
import { handleAndroidAccess } from './android-access.mjs'

const prefix = '/api/athena/android/auth/'
const completePath = '/android/sign-in'
const sessionCookie = /^(?:__Host-|__Secure-)?hermes_session_(?:at|rt|provider)$/
const ttl = 5 * 60 * 1000
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))

export function createAndroidAuthHandler({ target, fetch: request = globalThis.fetch, now = Date.now }) {
  const pending = new Map()
  return async (req, res) => {
    const url = new URL(req.url, 'http://local.invalid')
    if (url.pathname === '/api/athena/android/capabilities' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ protocol: 1, capabilities: ['access-sign-in', 'browser-sign-in', 'push-relay'] }))
      return true
    }
    if (!url.pathname.startsWith(prefix) && url.pathname !== completePath) return false
    const scheme = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? 'https' : 'http'
    const host = req.headers['x-forwarded-host'] || req.headers.host
    const origin = `${scheme}://${host}`
    const access = handleAndroidAccess(req, res, origin, now)
    if (access) return access
    const json = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
      res.end(JSON.stringify(body))
    }
    const page = (status, text, form = '') => {
      // Keep same-origin form POSTs from acquiring an opaque (null) Origin.
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff' })
      res.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Athena Android sign-in</title><h1>Athena Android</h1><p>${escape(text)}</p>${form}</html>`)
    }
    try {
      for (const [id, entry] of pending) if (now() - entry.created > ttl) pending.delete(id)
      if (req.method === 'POST' && req.headers.origin !== origin) return json(403, { error: 'Same-origin request required' }), true
      const readBody = async () => {
        let body = ''
        for await (const chunk of req) { body += chunk; if (body.length > 4096) throw new Error('Request too large') }
        return body
      }
      if (url.pathname === prefix + 'start' && req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'JSON required' }), true
        const { challenge, loginPath = '/login' } = JSON.parse(await readBody())
        if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) return json(400, { error: 'Invalid challenge' }), true
        if (pending.size >= 100) return json(429, { error: 'Try again later' }), true
        const login = new URL(loginPath, origin)
        if (login.origin !== origin || !['/login', '/auth/login'].includes(login.pathname)) return json(400, { error: 'Invalid sign-in path' }), true
        const id = randomBytes(32).toString('base64url')
        const code = randomBytes(3).toString('hex').toUpperCase()
        pending.set(id, { challenge, code, created: now(), origin, cookies: null })
        // Hermes rejects /api/* post-login destinations. The marker also bypasses older app-shell workers.
        login.searchParams.set('next', completePath + '?hermes-reconnect=1&id=' + id)
        json(200, { id, code, loginPath: login.pathname + login.search })
        return true
      }
      if ([completePath, prefix + 'complete'].includes(url.pathname) && ['GET', 'POST'].includes(req.method)) {
        const id = req.method === 'GET' ? url.searchParams.get('id') : new URLSearchParams(await readBody()).get('id')
        const entry = pending.get(id)
        if (!entry || entry.origin !== origin || entry.cookies) return page(410, 'This request has expired. Start sign-in again from the Android app.'), true
        const identity = await request(`${target}/api/auth/me`, {
          headers: { cookie: req.headers.cookie || '', 'x-forwarded-host': host, 'x-forwarded-proto': scheme },
          redirect: 'manual', signal: AbortSignal.timeout(6000)
        })
        if (!identity.ok) return page(401, 'Sign-in was not completed. Return to the Android app and try again.'), true
        if (req.method === 'GET') {
          const refreshed = identity.headers.getSetCookie()
          if (refreshed.length) res.setHeader('Set-Cookie', refreshed)
          page(200, `Check that the Android app shows code ${entry.code}. Only continue if you started this sign-in on your device. This moves your Athena sign-in from this browser to the Android app.`,
            `<form method="post" action="${completePath}"><input type="hidden" name="id" value="${escape(id)}"><button type="submit">Sign in to Athena Android</button></form>`)
        } else {
          // Transfer only Hermes's session cookies, never unrelated cookies or the provider's PKCE state.
          const cookies = new Map()
          for (const part of (req.headers.cookie || '').split(';')) {
            const index = part.indexOf('='); if (index < 1) continue
            const name = part.slice(0, index).trim()
            if (sessionCookie.test(name)) cookies.set(name, `${name}=${part.slice(index + 1).trim()}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000`)
          }
          for (const cookie of identity.headers.getSetCookie()) {
            if (sessionCookie.test(cookie.slice(0, cookie.indexOf('=')))) cookies.set(cookie.slice(0, cookie.indexOf('=')), cookie)
          }
          if (![...cookies.keys()].some(name => name.endsWith('hermes_session_at'))) return page(409, 'No transferable Hermes session was found. Use a session token in the app instead.'), true
          entry.cookies = [...cookies.values()]
          // Move rotating refresh credentials rather than sharing them between two cookie jars.
          res.setHeader('Set-Cookie', [...cookies.keys()].map(name => `${name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`))
          page(200, 'Sign-in approved. Close this browser window to return to the Athena Android app and finish connecting.')
        }
        return true
      }
      if (url.pathname === prefix + 'exchange' && req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'JSON required' }), true
        const { id, verifier } = JSON.parse(await readBody())
        const entry = pending.get(id)
        if (!entry || entry.origin !== origin || !/^[A-Za-z0-9_-]{43}$/.test(verifier) ||
          createHash('sha256').update(verifier).digest('base64url') !== entry.challenge) {
          return json(410, { error: 'Invalid or expired sign-in request' }), true
        }
        if (!entry.cookies) return json(202, { pending: true }), true
        pending.delete(id)
        json(200, { ok: true }, { 'Set-Cookie': entry.cookies })
        return true
      }
      json(404, { error: 'Unknown Android sign-in route' })
    } catch { if (!res.headersSent) json(400, { error: 'Could not complete Android sign-in' }); else res.end() }
    return true
  }
}
