import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function loadRecovery(globals) {
  const context = vm.createContext({ exports: {}, URL, ...globals, require: () => ({}) })
  const source = readFileSync(new URL('../apps/web-desktop/src/platform/startup-recovery.ts', import.meta.url), 'utf8')
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, context)
  return context.exports
}

test('proxy reconnect restores a dropped conversation fragment without replacing a selected conversation', () => {
  const store = new Map([['athena.startup-return-hash', '#/saved-conversation']])
  const sessionStorage = { getItem: key => store.get(key), removeItem: key => store.delete(key) }
  const window = {
    location: { href: 'https://web.example.test/?hermes-reconnect=1&source=bookmark' },
    history: { replaceState: (_state, _title, href) => { window.location.href = href } }
  }
  const recovery = loadRecovery({ window, sessionStorage })
  recovery.restoreStartupLocation()
  assert.equal(new URL(window.location.href).hash, '#/saved-conversation')
  window.location.href = 'https://web.example.test/?hermes-reconnect=1#/selected-conversation'
  recovery.restoreStartupLocation()
  assert.equal(new URL(window.location.href).hash, '#/selected-conversation')
  window.location.href = 'https://web.example.test/'
  recovery.restoreStartupLocation()
  assert.equal(new URL(window.location.href).hash, '')
  window.location.href = 'https://web.example.test/?hermes-reconnect=1'
  store.set('athena.startup-return-hash', 'https://untrusted.example.test/')
  recovery.restoreStartupLocation()
  assert.equal(new URL(window.location.href).hash, '')
  recovery.completeStartup()
  assert.equal(store.has('athena.startup-return-hash'), false)
  assert.equal(new URL(window.location.href).searchParams.has('hermes-reconnect'), false)
  sessionStorage.getItem = () => { throw new Error('Blocked storage') }
  assert.doesNotThrow(() => recovery.restoreStartupLocation())
})
