import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'
import path from 'node:path'
import { createBuildModuleLoader } from './renderer-adapter.mjs'

const compile = name => ts.transpileModule(readFileSync(`apps/web-desktop/src/${name}.ts`, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

function fixture({ android = false } = {}) {
  const listeners = new Map(), calls = []
  let operations = 0, activeWork, resolveApi, resolvePicker
  const bridge = {
    profile: {}, api: () => new Promise(resolve => { resolveApi = resolve }),
    selectPaths: () => new Promise(resolve => { resolvePicker = resolve }),
    openWindow() {}, openSessionWindow() {},
    getGatewayWsUrl: async () => ({ ok: true, wsUrl: 'ws://localhost/api/ws?ticket=one-use&native_dial=1' }),
    getGatewayWsUrlFor: async route => {
      if (route.profile === 'unserved') throw new Error('Profile is not served')
      return { ok: true, wsUrl: 'ws://localhost/api/ws?ticket=routed&profile=research&native_dial=1' }
    },
    oauthLogoutConnectionConfig: async () => {
      calls.push('logout')
      listeners.get('hermes:browser-reauth-required')({ preventDefault() {}, detail: { loginUrl: '/login' } })
      return { ok: true }
    }
  }
  const window = { location: { origin: 'http://localhost', assign: url => calls.push(['navigate', url]), reload: () => calls.push('reload') },
    addEventListener: (name, callback) => listeners.set(name, callback) }
  const context = vm.createContext({ exports: {}, window, URL, require: name => {
    if (name === '@/lib/browser-desktop-bridge') return { installBrowserDesktopBridge() { window.hermesDesktop = bridge; return true } }
    if (name === '@/lib/browser-viewport') return { installBrowserViewport() {} }
    if (name === '../platform/browser-default-profile') return { browserDefaultProfile: { getDefault() {}, setDefault() {}, onDefaultChanged() {} } }
    if (name === '../platform/android-push') return {
      androidPushGatewayUrl: async url => { calls.push(['ticket', url]); return url + '&relay=1' },
      resumeAndroidPush: async () => calls.push('resume-push'), stopAndroidPush: async () => calls.push('stop-push')
    }
    if (name === '../platform/android') return { isAndroidApp: () => android, androidOpenSignIn: async () => true }
    if (name === '../platform/reload-safety') return {
      assertSafeConnectionChange: async () => { if (operations) throw new Error('Finish pending work first') },
      beginOperation: () => { operations++; return () => operations-- },
      setActiveWork: value => { activeWork = value }
    }
    if (name === './external-links') return { openBrowserExternalLink() {} }
    if (name === '../platform/notifications') return { webNotify: async () => true }
    if (name === '@/store/notifications') return { notifyError: error => calls.push(['error', error.message]) }
    throw new Error(`Unexpected official adapter import: ${name}`)
  } })
  vm.runInContext(compile('upstream/official-host'), context)
  context.exports.installOfficialBrowserHost()
  return { bridge, calls, window, operations: () => operations, active: () => activeWork,
    finishApi: value => resolveApi(value), finishPicker: value => resolvePicker(value) }
}

test('the official adapter keeps mutation and file-picker lifetimes in Athena reload safety', async () => {
  const app = fixture()
  app.bridge.setActiveWork({ count: 2 })
  assert.equal(app.active().count, 2)
  const saving = app.bridge.api({ method: 'PATCH', path: '/api/config', body: {} })
  assert.equal(app.operations(), 1)
  await assert.rejects(app.bridge.oauthLogoutConnectionConfig('http://localhost'), /pending work/)
  assert.ok(!app.calls.includes('logout'))
  app.finishApi({ ok: true }); await saving
  assert.equal(app.operations(), 0)
  const picking = app.bridge.selectPaths({ multiple: false })
  assert.equal(app.operations(), 1)
  app.finishPicker([]); await picking
  assert.equal(app.operations(), 0)
  assert.equal((await app.bridge.oauthLogoutConnectionConfig('http://localhost')).ok, true)
  assert.ok(app.calls.includes('stop-push'))
  assert.ok(!app.calls.some(call => call[0] === 'navigate'), 'the guarded sign-out caller owns the final navigation')
})

test('Android relays the released one-use ticket and retains profile refusals without adding windows', async () => {
  const app = fixture({ android: true })
  assert.equal(app.bridge.openWindow, undefined)
  assert.equal(app.bridge.openSessionWindow, undefined)
  const result = await app.bridge.getGatewayWsUrlFor({ profile: 'research' })
  const url = new URL(result.wsUrl)
  assert.equal(url.searchParams.get('ticket'), 'routed')
  assert.equal(url.searchParams.get('native_dial'), '1')
  assert.equal(url.searchParams.get('profile'), 'research')
  await assert.rejects(app.bridge.getGatewayWsUrlFor({ profile: 'unserved' }), /not served/)
})

test('composer choice migration preserves existing official choices, draft bytes and rollback keys', () => {
  const values = new Map([
    ['hermes.desktop.composer.model.registry.web-single.research', 'old-choice'],
    ['hermes.desktop.composer.model.registry.local.research', 'new-choice'],
    ['hermes:composer-drafts:v3', '{"session":"web-single is part of my draft"}']
  ])
  const storage = { get length() { return values.size }, key: index => [...values.keys()][index],
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  const context = vm.createContext({ exports: {} })
  vm.runInContext(compile('platform/official-migration'), context)
  context.exports.migrateOfficialComposerPreferences(storage, 'http://localhost')
  assert.equal(values.get('hermes.desktop.composer.model.registry.local.research'), 'new-choice')
  assert.equal(values.get('hermes.desktop.composer.model.remote.http%3A%2F%2Flocalhost.research'), 'old-choice')
  assert.equal(values.get('hermes.desktop.composer.model.registry.web-single.research'), 'old-choice')
  assert.equal(values.get('hermes:composer-drafts:v3'), '{"session":"web-single is part of my draft"}')
})

test('the guarded official picker keeps the request profile through asynchronous selection and staging', async () => {
  const root = path.resolve('apps/web-desktop')
  const { useBrowserFilePicker } = createBuildModuleLoader().load(path.join(root, 'build/renderer/transforms/host.ts'))
  const adapted = useBrowserFilePicker(readFileSync('apps/desktop/src/lib/browser-uploads.ts', 'utf8'), root)
  const tree = ts.createSourceFile('uploads.ts', adapted, ts.ScriptTarget.Latest, true)
  const picker = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'selectBrowserFiles')
  const selected = Promise.withResolvers(), staged = [], options = []
  const context = vm.createContext({ exports: {},
    pickBrowserFiles: value => { options.push(value); return selected.promise },
    stageBrowserFile: async (_bootstrap, file, profile) => { staged.push({ file, profile }); return '/uploads/review.txt' }
  })
  vm.runInContext(ts.transpileModule('export ' + picker.getText(tree), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
  const pending = context.exports.selectBrowserFiles({}, { profile: 'research', multiple: false }, 'default', () => {})
  assert.equal(options[0].multiple, false)
  selected.resolve([{ name: 'review.txt' }])
  assert.equal((await pending)[0], '/uploads/review.txt')
  assert.equal(staged[0].profile, 'research')
})
