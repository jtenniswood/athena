import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync(new URL('../apps/web-desktop/src/platform/android-push.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText
function fixture({ storage = new Map(), unavailable = false, slowDiagnostics = false } = {}) {
  const requests = [], native = [], timers = new Map()
  const context = vm.createContext({ exports: {}, URL, crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    document: { addEventListener() {} }, window: {
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
      setInterval: fn => { timers.set(1, fn); return 1 }, clearInterval: id => timers.delete(id)
    },
    require: name => name === './android' ? {
      isAndroidApp: () => true,
      androidVisibleSession: () => null,
      androidPushRegistration: async () => ({ deviceId: 'installation', token: 'fake-token', refreshKey: 'scoped-key' }),
      setAndroidPushActive: async (...args) => { native.push(args) }, androidPushDiagnostics: async () => {}
    } : { apiFetch: async request => {
      requests.push(request)
      if (unavailable) throw new Error('Service unavailable')
      if (request.method === 'GET' && slowDiagnostics) return new Promise(() => {})
      return request.method === 'POST' ? { bindingId: 'server-account-specific-binding' }
        : request.method === 'GET' ? { persistent: true, pending: 0, lastDelivery: null } : { ok: true }
    } }
  })
  vm.runInContext(source, context)
  return { api: context.exports, requests, native, storage, timers }
}

test('optional delivery diagnostics cannot hold up chat and the native host uses the server account binding', async () => {
  const app = fixture({ slowDiagnostics: true })
  const target = await app.api.androidPushGatewayUrl('wss://athena.example/api/ws?ticket=one-use')
  assert.match(target, /\/api\/athena\/android\/ws\?ticket=one-use&device=installation/)
  assert.equal(app.requests[0].body.accountScopedBinding, true)
  assert.equal(app.native[0][1], 'server-account-specific-binding')
  assert.equal(app.native[0][2], 'fake-token')
  assert.equal(app.requests[0].body.refreshKey, 'scoped-key')
})

test('page reloads retain the installation seed, and sign-out removes it and revokes push', async () => {
  const storage = new Map()
  const first = fixture({ storage }), second = fixture({ storage })
  await first.api.androidPushGatewayUrl('wss://athena.example/api/ws')
  await second.api.androidPushGatewayUrl('wss://athena.example/api/ws')
  assert.equal(first.requests[0].body.bindingId, second.requests[0].body.bindingId)
  await second.api.stopAndroidPush()
  assert.equal(storage.has('athena:android-push-binding'), false)
  assert.equal(second.native.at(-1)[0], false)
  assert.equal(second.requests.at(-1).method, 'DELETE')
  assert.equal(second.timers.size, 0)
})

test('an unavailable optional push service falls back to the ordinary gateway', async () => {
  const app = fixture({ unavailable: true })
  const target = 'wss://athena.example/api/ws?ticket=one-use'
  assert.equal(await app.api.androidPushGatewayUrl(target), target)
  assert.equal(app.native.at(-1)[0], false)
})
