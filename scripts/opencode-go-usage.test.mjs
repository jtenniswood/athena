import assert from 'node:assert/strict'
import { createServer } from 'node:http'
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

async function start(t, options) {
  const services = createAthenaServices({ target, directory: '/unused', ...options })
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

test('usage requires Hermes authentication and shares only the quota snapshot', async t => {
  let clock = 0
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
    assert.deepEqual(await response.json(), { usage })
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
