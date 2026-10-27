import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { createAndroidAuthHandler } from './android-auth.mjs'

async function fixture(t) {
  let clock = 0
  const handler = createAndroidAuthHandler({ target: 'http://gateway.test', now: () => clock,
    fetch: async (_url, options) => options.headers.cookie?.includes('hermes_session_at=valid')
      ? Response.json({ user_id: 'account-A' }, { headers: { 'Set-Cookie': '__Host-hermes_session_at=renewed; Path=/; Secure; HttpOnly; SameSite=Lax' } })
      : Response.json({}, { status: 401 }) })
  const server = createServer((req, res) => { void handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  const route = '/api/athena/android/auth/'
  const verifier = 'a'.repeat(43)
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const post = (path, body, extra = {}) => fetch(origin + route + path, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body)
  })
  const start = async () => (await post('start', { challenge })).json()
  return { origin, route, verifier, challenge, post, start, advance: () => { clock += 300001 } }
}

test('browser sign-in requires account authentication, explicit approval and the original PKCE verifier', async t => {
  const { origin, route, verifier, post, start } = await fixture(t)
  const request = await start()
  assert.match(request.id, /^[A-Za-z0-9_-]{43}$/)
  assert.match(request.code, /^[A-F0-9]{6}$/)
  assert.match(request.loginPath, /^\/login\?next=/)
  assert.equal((await post('exchange', { id: request.id, verifier })).status, 202)
  const complete = origin + route + 'complete?id=' + request.id
  assert.equal((await fetch(complete)).status, 401)
  const cookie = '__Host-hermes_session_at=valid; __Host-hermes_session_rt=refresh; analytics=private'
  const preview = await fetch(complete, { headers: { Cookie: cookie } })
  assert.equal(preview.status, 200)
  assert.match(await preview.text(), new RegExp(request.code))
  assert.equal((await post('exchange', { id: request.id, verifier })).status, 202, 'viewing the page does not approve sign-in')
  const approve = await fetch(origin + route + 'complete', {
    method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id: request.id })
  })
  assert.equal(approve.status, 200)
  assert.equal((await post('exchange', { id: request.id, verifier: 'b'.repeat(43) })).status, 410)
  const exchange = await post('exchange', { id: request.id, verifier })
  assert.equal(exchange.status, 200)
  assert.equal(exchange.headers.get('cache-control'), 'no-store')
  const cookies = exchange.headers.getSetCookie()
  assert.ok(cookies.some(cookie => cookie.startsWith('__Host-hermes_session_at=renewed;')))
  assert.ok(cookies.some(cookie => cookie.startsWith('__Host-hermes_session_rt=refresh;')))
  assert.ok(cookies.every(cookie => !cookie.includes('analytics')))
  assert.deepEqual(await exchange.json(), { ok: true }, 'credentials never appear in the JSON payload')
  assert.equal((await post('exchange', { id: request.id, verifier })).status, 410, 'handoff can only be redeemed once')
})

test('sign-in rejects cross-origin approval, redirects to other sites, and expired requests', async t => {
  const { challenge, post, start, advance, verifier } = await fixture(t)
  assert.equal((await post('start', { challenge }, { Origin: 'https://attacker.test' })).status, 403)
  assert.equal((await post('start', { challenge }, { Origin: 'null' })).status, 403)
  assert.equal((await post('start', { challenge, loginPath: 'https://attacker.test/login' })).status, 400)
  assert.equal((await post('start', { challenge, loginPath: '/api/auth/logout' })).status, 400)
  const request = await start()
  advance()
  assert.equal((await post('exchange', { id: request.id, verifier })).status, 410)
})
