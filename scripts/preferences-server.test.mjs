import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createPreferencesHandler, createPreferenceStore, preferencesPath } from './preferences-server.mjs'
import { isPreferenceKey, validatePreferenceValues } from './preference-schema.mjs'

const theme = 'hermes-desktop-theme-v2'
const layout = 'hermes-web.browser.hermes.desktop.layoutTree.v2.simple'

test('sync allowlist includes sidebar layouts and preferences, never active work or credentials', () => {
  for (const key of [theme, layout, 'hermes:native-notifications', 'hermes-web.default-profile-route.v1']) assert.equal(isPreferenceKey(key), true)
  for (const key of ['hermes:composer-drafts:v3', 'hermes.desktop.composerQueue.v1', 'hermes.desktop.lastSessionId', 'hermes-web.session-token', 'hermes-ui.gateways', '__proto__']) {
    assert.equal(isPreferenceKey(key), false)
    assert.throws(() => validatePreferenceValues({ [key]: 'secret' }))
  }
  assert.throws(() => validatePreferenceValues({ [theme]: {} }))
  assert.throws(() => validatePreferenceValues({ [theme]: 'x'.repeat(128 * 1024 + 1) }))
})

test('authenticated HTTP storage isolates accounts, rejects stale accounts and CSRF, and survives restart', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'athena-preferences-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const handler = createPreferencesHandler({ target: 'http://gateway.test', directory, fetch: async (url, options) => {
    assert.equal(url, 'http://gateway.test/api/auth/me')
    assert.equal(options.redirect, 'manual')
    const user = options.headers.cookie === 'session=A' ? 'A' : options.headers.cookie === 'session=B' ? 'B' : options.headers['x-hermes-session-token'] === 'valid' ? 'local' : null
    if (!user) return Response.json({}, { status: 401 })
    return Response.json({ user_id: user, provider: 'test', org_id: 'org' }, { headers: { 'Set-Cookie': 'session=renewed; HttpOnly' } })
  } })
  const server = createServer((req, res) => { void handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  const call = (user, body, extra = {}) => fetch(origin + preferencesPath, {
    method: body ? 'PATCH' : 'GET',
    headers: { Cookie: `session=${user}`, Origin: origin, 'Content-Type': 'application/json', ...extra },
    body: body ? JSON.stringify(body) : undefined
  })
  assert.equal((await call('invalid')).status, 401)
  const response = await call('A')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('set-cookie'), 'session=renewed; HttpOnly')
  const a = await response.json()
  const b = await (await call('B')).json()
  assert.notEqual(a.accountId, b.accountId)
  const patch = changes => ({ version: 1, accountId: a.accountId, seed: false, changes })
  assert.equal((await call('A', patch({ [theme]: 'dark' }), { Origin: 'https://attacker.test' })).status, 403)
  assert.equal((await call('B', patch({ [theme]: 'dark' }))).status, 409)
  assert.equal((await call('A', patch({ token: 'secret' }))).status, 400)
  const replies = await Promise.all([call('A', patch({ [theme]: 'dark' })), call('A', patch({ [layout]: '{"kind":"split"}' }))])
  assert.ok(replies.every(reply => reply.status === 200))
  const saved = await (await call('A')).json()
  assert.equal(saved.values[theme], 'dark')
  assert.equal(saved.values[layout], '{"kind":"split"}')
  assert.deepEqual((await (await call('B')).json()).values, {})
  const seed = { ...patch({ [theme]: 'stale', 'hermes-web.browser.followup-behavior': 'steer' }), seed: true }
  assert.equal((await call('A', seed)).status, 200)
  assert.equal((await (await call('A')).json()).values[theme], 'dark')
  await call('A', patch({ [theme]: null }))
  await call('A', seed)
  const restarted = createPreferenceStore(directory)
  assert.equal((await restarted.read(a.accountId)).values[theme], null, 'deletion tombstones prevent migration reviving old preferences')
  const files = await readdir(directory)
  assert.equal(files.length, 1)
  assert.match(files[0], /^[a-f0-9]{64}\.json$/)
  assert.ok(!(await readFile(path.join(directory, files[0]), 'utf8')).includes('session='))
  const token = await call('invalid', undefined, { 'X-Hermes-Session-Token': 'valid' })
  assert.equal(token.status, 200)
})

test('unverifiable gateway responses never create an anonymous shared account', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'athena-preferences-invalid-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const reply of [Response.json({ authenticated: true }), new Response('', { status: 302 }), Response.json({}, { status: 503 })]) {
    let status
    const handler = createPreferencesHandler({ target: 'http://gateway.test', directory, fetch: async () => reply })
    await handler({ method: 'GET', url: preferencesPath, headers: {}, socket: {} }, {
      setHeader() {}, writeHead(value) { status = value }, end() {}
    })
    assert.equal(status, 503)
  }
  assert.deepEqual(await readdir(directory), [])
})
