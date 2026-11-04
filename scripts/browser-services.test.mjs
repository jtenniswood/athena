import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function load(name, globals) {
  const source = readFileSync(new URL(`../apps/web-desktop/src/platform/${name}.ts`, import.meta.url), 'utf8')
  const context = vm.createContext({ exports: {}, Blob, URL, ...globals })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
  return context.exports
}

test('browser attachments preserve bytes and reject unknown handles', async () => {
  class Reader {
    async readAsDataURL(blob) {
      this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`
      this.onload()
    }
  }
  const files = load('files', { FileReader: Reader, require: () => ({ servingBase: () => 'https://web.example.test' }) })
  const handle = files.registerWebFile(new Blob(['pasted text'], { type: 'text/plain' }), '../note.txt')
  assert.match(handle, /^web-file:\/\/\d+\/_note\.txt$/)
  assert.equal(await files.webFileAsDataUrl(handle), 'data:text/plain;base64,cGFzdGVkIHRleHQ=')
  await assert.rejects(files.webFileAsDataUrl('web-file://unknown'), /unavailable/)
  assert.equal(files.isUnderPluginRoot('https://web.example.test/pluginsSecret'), false)
})

test('API errors keep the shell in place and websocket tickets are minted per call', async () => {
  let calls = []
  let response = { ok: true, json: async () => ({ ticket: `ticket-${calls.length}` }) }
  const client = load('connection', {
    URL, AbortSignal,
    window: { location: { href: 'https://web.example.test/' } },
    localStorage: { getItem: () => null },
    fetch: async (...args) => { calls.push(args); return response },
    require: () => ({
      getActiveGateway: () => ({ url: '', authMode: 'oauth' }),
      normalizeBase: () => 'https://web.example.test',
      activeUpstreamOrigin: () => null,
      withGatewayRoute: url => url
    })
  })
  assert.equal(await client.mintWsTicket(null), 'ticket-1')
  assert.equal(await client.mintWsTicket(null), 'ticket-2')
  response = { ok: false, status: 401, text: async () => 'Sign in again' }
  await assert.rejects(client.apiFetch({ path: '/api/session' }), /401: Sign in again/)
  response = { ok: true, text: async () => '<html>wrong route</html>' }
  await assert.rejects(client.apiFetch({ path: '/api/session' }), /Expected JSON/)
})

test('Android OAuth verifies the cookie session even while an existing token remains saved', async () => {
  let probes = 0
  const client = load('connection', {
    AbortSignal,
    window: { location: { href: 'https://web.example.test/' }, setTimeout: callback => { queueMicrotask(callback) } },
    fetch: async (_url, options) => {
      assert.equal(options.credentials, 'same-origin')
      assert.equal(options.headers?.['X-Hermes-Session-Token'], undefined)
      probes++
      return probes === 1 ? Response.json({}, { status: 401 }) : Response.json({ user_id: 'preview-user', provider: 'preview' })
    },
    require: () => ({
      isAndroidApp: () => true, androidOpenSignIn: async () => true,
      getActiveGateway: () => ({ url: '', authMode: 'token', token: 'synthetic-existing-token' }),
      normalizeBase: () => 'https://web.example.test',
      activeUpstreamOrigin: () => null, withGatewayRoute: url => url
    })
  })
  assert.equal((await client.openOauthLoginPopup('https://web.example.test', null)).connected, true)
  assert.equal(probes, 2, 'the first signed-out cookie probe cannot use the saved token')
})

test('explicit endpoint profile filters take precedence over ambient API scope', async () => {
  const calls = []
  let finished = 0
  const client = load('connection', {
    AbortSignal,
    fetch: async (url, options) => { calls.push({ url, options }); return Response.json({ ok: true }) },
    require: () => ({
      getActiveGateway: () => ({ url: '', authMode: 'token', token: 'synthetic-scope-token' }),
      normalizeBase: () => 'https://web.example.test', activeUpstreamOrigin: () => null,
      withGatewayRoute: url => url, beginOperation: () => () => { finished++ }
    })
  })
  for (const path of [
    '/api/cron/jobs?profile=default', '/api/cron/jobs?profile=all', '/api/cron/jobs?profile=',
    '/api/cron/jobs?%70rofile=writer', '/api/cron/jobs?profile=R%26D%20%2F%20writing&cursor=a%2Bb'
  ]) {
    await client.apiFetch({ path, profile: 'research' })
    assert.equal(calls.at(-1).url, 'https://web.example.test' + path, 'preserve the endpoint query bytes')
    assert.equal(new URL(calls.at(-1).url).searchParams.getAll('profile').length, 1)
  }
  for (const [path, profile, expected] of [
    ['/api/sessions', 'research', ['research']],
    ['/api/sessions?q=profile%3Dwriter', 'R&D / writing', ['R&D / writing']],
    ['/api/sessions?limit=10', undefined, []]
  ]) {
    await client.apiFetch({ path, profile })
    const query = new URL(calls.at(-1).url).searchParams
    assert.deepEqual(query.getAll('profile'), expected)
    if (path.includes('q=')) assert.equal(query.get('q'), 'profile=writer')
    if (path.includes('limit=')) assert.equal(query.get('limit'), '10')
  }
  await client.apiFetch({ path: '/api/config?profile=writer', profile: 'research', method: 'PUT', body: { enabled: false } })
  assert.equal(calls.at(-1).url, 'https://web.example.test/api/config?profile=writer')
  assert.equal(calls.at(-1).options.body, '{"enabled":false}')
  assert.equal(finished, 1, 'the existing write-operation lifetime remains intact')
  for (const { options } of calls) {
    assert.equal(options.credentials, 'same-origin')
    assert.equal(options.headers['X-Hermes-Session-Token'], 'synthetic-scope-token')
  }
})

test('plugin asset admission follows browser URL normalization for both roots', () => {
  const files = load('files', { require: () => ({ servingBase: () => 'https://web.example.test' }) })
  for (const root of ['plugins', 'desktop-plugins']) {
    for (const suffix of ['', '/', '/review-widget/package.json', '/nested/../review-widget/package.json', '/file%20name.json', '/%2econfig']) {
      assert.equal(files.isUnderPluginRoot(`https://web.example.test/${root}${suffix}`), true, suffix)
    }
    for (const suffix of ['Secret', '/../api/config', '/%2e%2e/api/config', '/nested/../../api/config', '/nested/%2f..%2f..%2fapi/config', '/nested/%5c..%5c..%5capi/config', '?alternate=/api/config', '#/api/config']) {
      assert.equal(files.isUnderPluginRoot(`https://web.example.test/${root}${suffix}`), false, suffix)
    }
    assert.equal(files.isUnderPluginRoot(String.raw`https://web.example.test/${root}/nested/..\..\api/config`), false)
    assert.equal(files.isUnderPluginRoot(`https://web.example.test:444/${root}/package.json`), false)
    assert.equal(files.isUnderPluginRoot(`https://other.example.test/${root}/package.json`), false)
    assert.equal(files.isUnderPluginRoot(`https://user:password@web.example.test/${root}/package.json`), false)
    assert.equal(files.isUnderPluginRoot(`/${root}/package.json`), false)
  }
  assert.equal(files.isUnderPluginRoot('not a URL'), false)
})
