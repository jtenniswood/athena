import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createAthenaServices } from '../apps/web-desktop/server/services.mjs'
import { accountIdentity } from '../apps/web-desktop/server/identity.mjs'

const deviceId = '11111111-1111-4111-8111-111111111111'
const bindingId = '22222222-2222-4222-8222-222222222222'
const target = 'http://gateway.test'

for (const mode of ['standalone', 'middleware']) {
  test(`${mode} hosting shares authenticated preferences, Android routes and account ownership`, async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'athena-services-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const probes = []
    const services = createAthenaServices({ target, directory,
      sender: { enabled: true, send: async () => {} },
      fetch: async (url, options) => {
        probes.push({ url, ...options })
        return options.headers.cookie === 'session=A'
          ? Response.json({ user_id: 'A', provider: 'test', org_id: 'org' }, { headers: { 'Set-Cookie': 'session=renewed; HttpOnly' } })
          : Response.json({}, { status: 401 })
      }
    })
    const fallback = (req, res) => { res.writeHead(mode === 'middleware' ? 204 : 404); res.end() }
    const server = createServer((req, res) => { void services.handle(req, res).then(handled => { if (!handled) fallback(req, res) }) })
    services.attach(server)
    services.attach(server)
    assert.equal(server.listenerCount('upgrade'), 1)
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(async () => { services.close(); services.close(); await services.drain(); await new Promise(resolve => server.close(resolve)) })
    const origin = `http://127.0.0.1:${server.address().port}`
    const call = (route, body, headers = {}) => fetch(origin + route, {
      method: body ? 'POST' : 'GET',
      headers: { Cookie: 'session=A', Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: body && JSON.stringify(body)
    })
    const preferences = await call('/api/athena/preferences')
    assert.equal(preferences.status, 200)
    assert.equal(preferences.headers.get('set-cookie'), 'session=renewed; HttpOnly')
    const { accountId } = await preferences.json()
    const registered = await call('/api/athena/android/push', { deviceId, bindingId, token: 'test-token'.repeat(4), enabled: true })
    assert.equal(registered.status, 200)
    assert.equal(registered.headers.get('set-cookie'), 'session=renewed; HttpOnly')
    const saved = JSON.parse(await readFile(path.join(directory, 'android-push.json'), 'utf8'))
    assert.equal(saved.devices[0][0], `${accountId}:${deviceId}`)
    assert.equal((await call('/api/athena/android/push', { deviceId, bindingId, token: 'test-token'.repeat(4) }, { Origin: 'https://other.test' })).status, 403)
    assert.equal((await call('/api/athena/preferences', undefined, { Cookie: 'session=B' })).status, 401)
    assert.equal((await (await call('/api/athena/android/capabilities')).json()).protocol, 1)
    const count = probes.length
    assert.equal((await call('/unowned-route')).status, mode === 'middleware' ? 204 : 404)
    assert.equal(probes.length, count, 'unowned routes must not authenticate or contact Hermes')
    assert.ok(probes.every(probe => probe.url === target + '/api/auth/me' && probe.redirect === 'manual'))
  })
}

test('account identity rejects ambiguous ownership and keeps deployment, provider and organization scopes', () => {
  const a = { user_id: 'A', provider: 'test', org_id: 'org' }
  const id = accountIdentity(target, a)
  for (const changed of [{ ...a, user_id: 'B' }, { ...a, provider: 'other' }, { ...a, org_id: 'other' }]) {
    assert.notEqual(accountIdentity(target, changed), id)
  }
  assert.notEqual(accountIdentity('http://other.test', a), id)
  assert.equal(accountIdentity(target, { ...a, org_id: null }), accountIdentity(target, { ...a, org_id: '' }))
  for (const malformed of [null, {}, { ...a, provider: '' }, { ...a, org_id: {} }, { ...a, user_id: '' }]) {
    assert.throws(() => accountIdentity(target, malformed), /verify/)
  }
})

test('a Webapp listener migration reads the existing preference account and authenticates only at the new target', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'athena-listener-migration-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const identityUrl = 'http://gateway.test:9119', next = 'http://gateway.test:9120'
  const urls = []
  const services = createAthenaServices({ target: next, identityUrl, directory,
    sender: { enabled: false, send: async () => {} },
    fetch: async url => { urls.push(url); return Response.json({ user_id: 'A', provider: 'test', org_id: '' }) }
  })
  const server = createServer((req, res) => { void services.handle(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { services.close(); await new Promise(resolve => server.close(resolve)) })
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/athena/preferences`, { headers: { Cookie: 'session=A' } })
  assert.equal((await response.json()).accountId, accountIdentity(identityUrl, { user_id: 'A', provider: 'test' }))
  assert.deepEqual(urls, [next + '/api/auth/me'])
})
