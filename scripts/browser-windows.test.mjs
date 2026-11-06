import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'
import { browserPreferences } from './browser-preference-contract.mjs'

const compile = file => ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText

test('unsupported browser hosts lack app-window capabilities while preinstalled hosts retain theirs', () => {
  for (const [android, athena, channel] of [[true, true, true], [false, false, true], [false, true, false]]) {
    const existing = () => Promise.resolve({ ok: true })
    const window = { addEventListener() {}, __HERMES_WEB_BRIDGE__: athena, hermesDesktop: athena ? {} : { openWindow: existing, openSessionWindow: existing } }
    if (athena) {
      const construction = vm.createContext({ exports: {}, window, require: () => ({
        browserCapabilities: () => ({ secureTokenStorage: false }), createWebZoomBridge: () => ({}),
        resolveToken: () => '', installBrowserDesktopBridge: () => {
          window.hermesDesktop = { profile: {}, openWindow: existing, openSessionWindow: existing, terminal: {} }
          return true
        },
        browserDefaultProfile: { getDefault() {}, setDefault() {}, onDefaultChanged() {} }
      }) })
      vm.runInContext(compile('apps/web-desktop/src/upstream/bridge.ts'), construction)
      window.hermesDesktop = construction.exports.createWebBridge()
    }
    const context = vm.createContext({ exports: {}, window, URL, ...(channel ? { BroadcastChannel: class {} } : {}), require: name => {
      if (name.endsWith('/android')) return { isAndroidApp: () => android }
      return { createBrowserWindowOpener: () => { throw new Error('Host windows must remain unchanged') } }
    } })
    vm.runInContext(compile('apps/web-desktop/src/upstream/browser-windows.ts'), context)
    context.exports.installBrowserWindowCommands()
    const engine = vm.createContext({ exports: {}, window, require: () => ({}) })
    vm.runInContext(compile('apps/desktop/src/store/windows.ts'), engine)
    assert.equal(engine.exports.canOpenNewWindow(), !athena)
    assert.equal(engine.exports.canOpenSessionWindow(), !athena)
    if (!athena) assert.equal(window.hermesDesktop.openWindow, existing)
  }
})

test('tab profile routes override saved state and remember changes without losing history state', () => {
  const values = new Map([[browserPreferences.sessionProfile.key, 'research']])
  const state = { idx: 2, key: 'router-owner', usr: { draft: 'kept' } }
  const window = { location: { href: 'https://web.example.test/?profile=writer&keep=1#/chat' }, history: { state,
    replaceState(value, _title, url) { assert.equal(value, state); window.location.href = new URL(url, window.location.href).href } } }
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  const context = vm.createContext({ exports: {}, window, URL, sessionStorage: storage, require: () => ({ browserPreferences }) })
  vm.runInContext(compile('apps/web-desktop/src/platform/tab-profile.ts'), context)
  const { readBrowserTabProfile, rememberBrowserTabProfile } = context.exports
  assert.equal(readBrowserTabProfile(), 'writer')
  rememberBrowserTabProfile('research')
  assert.equal(readBrowserTabProfile(), 'research')
  assert.equal(new URL(window.location.href).searchParams.get('keep'), '1')
  assert.equal(new URL(window.location.href).hash, '#/chat')
  storage.setItem = () => { throw new Error('Storage blocked') }
  rememberBrowserTabProfile('writer')
  assert.equal(readBrowserTabProfile(), 'writer')
  window.location.href = 'https://web.example.test/#/chat'
  storage.getItem = () => { throw new Error('Storage blocked') }
  assert.equal(readBrowserTabProfile(), null)
})
