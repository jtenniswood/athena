import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createAthenaServices } from '../apps/web-desktop/server/services.mjs'
import { runtimeConfiguration, runtimeScripts } from './runtime-config.mjs'

const route = '/api/athena/opencode-go/usage'
const target = 'https://gateway.test'
const apiKey = 'test-opencode-go-key'
const token = 'test-hermes-token'
const usage = {
  rolling: { percent: 15, resetsAt: '2026-11-10T12:30:00.000Z' },
  weekly: { percent: 23, resetsAt: '2026-11-16T00:00:00.000Z' },
  monthly: { percent: 41, resetsAt: '2026-12-01T12:30:00.000Z' }
}

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'athena-opencode-go-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

async function start(t, options) {
  const services = createAthenaServices({ target, directory: options.directory ?? await temporaryDirectory(t), ...options })
  const server = createServer(async (req, res) => {
    if (!await services.handle(req, res)) {
      res.writeHead(204)
      res.end()
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    services.close()
    await new Promise(resolve => server.close(resolve))
  })
  return (headers, method = 'GET') => fetch(`http://127.0.0.1:${server.address().port}${route}`, { headers, method })
}

test('only a capability flag is exposed in browser runtime configuration', () => {
  assert.equal(runtimeConfiguration({ OPENCODE_GO_API_KEY: ' ' }).publicConfig.capabilities.openCodeGoUsage, false)
  const config = runtimeConfiguration({ OPENCODE_GO_API_KEY: ` ${apiKey} ` })
  assert.equal(config.openCodeGoApiKey, apiKey)
  assert.equal(config.publicConfig.capabilities.openCodeGoUsage, true)
  for (const source of Object.values(runtimeScripts(config))) assert.ok(!source.includes(apiKey))
})

test('disabled usage does not authenticate or fetch provider data', async t => {
  const request = await start(t, { fetch: () => assert.fail('Unexpected upstream request') })
  assert.equal((await request()).status, 404)
})

test('usage requires Hermes authentication and shares only sanitized quota data', async t => {
  let clock = Date.parse('2026-11-10T12:00:00.000Z')
  let providerReads = 0
  let providerPayload = { usage: { ...usage, monthly: { ...usage.monthly, internal: apiKey } } }
  const request = await start(t, { openCodeGoApiKey: apiKey, now: () => clock, fetch: async (url, options) => {
    if (url === target + '/api/auth/me') {
      assert.ok(!JSON.stringify(options.headers).includes(apiKey))
      if (options.headers['x-hermes-session-token'] !== token && options.headers.cookie !== 'session=browser') {
        return Response.json({}, { status: 401 })
      }
      return Response.json({ user_id: 'test', provider: 'test' }, { headers: { 'Set-Cookie': 'session=browser; HttpOnly' } })
    }
    assert.equal(url, 'https://opencode.ai/inference/go/v1/usage')
    assert.deepEqual(options.headers, { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' })
    assert.equal(options.redirect, 'error')
    providerReads++
    return Response.json(providerPayload)
  } })

  const tokenHeaders = { 'X-Hermes-Session-Token': token }
  assert.equal((await request()).status, 401)
  assert.equal((await request(tokenHeaders, 'POST')).status, 405)
  assert.equal(providerReads, 0)

  const responses = await Promise.all([request(tokenHeaders), request({ Cookie: 'session=browser' })])
  for (const response of responses) {
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('set-cookie'), 'session=browser; HttpOnly')
    assert.deepEqual(await response.json(), { usage, monthlyHistory: [{ at: clock, percent: 41 }] })
  }
  assert.equal(providerReads, 1)
  assert.equal((await request()).status, 401, 'a cached result still requires authentication')

  clock += 60_000
  providerPayload = { usage: { ...usage, monthly: { percent: apiKey } } }
  const invalid = await request(tokenHeaders)
  assert.equal(invalid.status, 503)
  assert.ok(!(await invalid.text()).includes(apiKey))
  providerPayload = { usage }
  assert.equal((await request(tokenHeaders)).status, 200)
  assert.equal(providerReads, 3)
})

test('monthly samples survive a restart and stay within the provider key and billing period', async t => {
  const directory = await temporaryDirectory(t)
  const hour = 3_600_000
  const first = Date.parse('2026-11-10T12:00:00.000Z')
  let clock = first
  let monthly = { ...usage.monthly }
  const options = { directory, openCodeGoApiKey: apiKey, now: () => clock, fetch: async url =>
    url === target + '/api/auth/me' ? Response.json({ user_id: 'test', provider: 'test' })
      : Response.json({ usage: { ...usage, monthly } }) }
  let request = await start(t, options)
  const history = async () => {
    const response = await request()
    assert.equal(response.status, 200)
    return (await response.json()).monthlyHistory
  }

  assert.deepEqual(await history(), [{ at: first, percent: 41 }])
  clock += hour / 2
  monthly.percent = 45
  assert.deepEqual(await history(), [{ at: first, percent: 41 }, { at: clock, percent: 45 }])
  clock += hour / 2
  monthly.percent = 47
  monthly.resetsAt = '2026-12-01T12:30:00.750Z'
  request = await start(t, options)
  assert.deepEqual(await history(), [{ at: first, percent: 41 }, { at: clock, percent: 47 }])
  assert.ok(!(await readFile(path.join(directory, 'opencode-go-history.json'), 'utf8')).includes(apiKey))

  clock = Date.parse(monthly.resetsAt) + hour
  monthly = { percent: 2, resetsAt: '2027-01-01T12:30:00.000Z' }
  assert.deepEqual(await history(), [{ at: clock, percent: 2 }])

  clock += hour
  monthly.percent = 19
  request = await start(t, { ...options, openCodeGoApiKey: 'another-test-key' })
  assert.deepEqual(await history(), [{ at: clock, percent: 19 }])
})
