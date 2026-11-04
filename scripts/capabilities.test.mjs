import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../apps/web-desktop/src/platform/capabilities.ts', import.meta.url), 'utf8')
function load() {
  const context = vm.createContext({ exports: {}, navigator: undefined, window: undefined })
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, context)
  return context.exports
}

test('browser facts report API availability without native capabilities', () => {
  const { browserCapabilities } = load()
  const facts = browserCapabilities({ clipboard: true, notifications: true, microphone: true })
  assert.equal(facts.clipboard, true)
  assert.equal(facts.notifications, true)
  assert.equal(facts.microphone, true)
  assert.equal(facts.secureTokenStorage, false)
  assert.equal(facts.nativeTerminal, false)
})

test('browser facts explicitly report unsupported native features and missing APIs', () => {
  const { browserCapabilities } = load()
  const facts = browserCapabilities({ clipboard: false, notifications: false, microphone: false })
  assert.equal(facts.nativeTerminal, false)
  assert.equal(facts.clipboard, false)
  assert.equal(facts.notifications, false)
  assert.equal(facts.microphone, false)
})
