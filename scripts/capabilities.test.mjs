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

test('browser API availability does not claim that permissions were granted', () => {
  const { observeBrowserCapabilities } = load()
  const observations = observeBrowserCapabilities({ clipboard: true, notifications: true, microphone: true })
  assert.equal(observations.find(item => item.id === 'browser.microphone').state, 'supported')
  assert.match(observations.find(item => item.id === 'browser.microphone').evidence, /permission/)
  assert.match(observations.find(item => item.id === 'browser.notifications').evidence, /permission/)
})

test('browser facts explicitly report unsupported native features and missing APIs', () => {
  const { observeBrowserCapabilities } = load()
  const observations = observeBrowserCapabilities({ clipboard: false, notifications: false, microphone: false })
  assert.equal(observations.find(item => item.id === 'browser.nativeTerminal').state, 'unsupported')
  assert.equal(observations.find(item => item.id === 'browser.clipboard').state, 'unsupported')
})

test('hosting facts preserve unknown when the runtime does not report a value', () => {
  const { observeHostingCapabilities } = load()
  const observations = observeHostingCapabilities({ gatewaySelection: false, pluginAssets: true })
  assert.equal(observations.find(item => item.id === 'hosting.gateway-selection').state, 'unsupported')
  assert.equal(observations.find(item => item.id === 'hosting.plugin-assets').state, 'supported')
  assert.equal(observeHostingCapabilities().every(item => item.state === 'unknown'), true)
})

test('required-source resolution keeps unknown separate and lets unsupported evidence decide', () => {
  const { observeServerCapability, resolveCapability } = load()
  const observations = [
    { id: 'chat', source: 'browser', state: 'supported', evidence: 'Browser API exists.' },
    observeServerCapability('chat')
  ]
  assert.equal(resolveCapability('chat', ['browser', 'server'], observations).state, 'unknown')
  observations.push({ id: 'chat', source: 'hosting', state: 'unsupported', evidence: 'Host disables the feature.' })
  assert.equal(resolveCapability('chat', ['browser', 'server', 'hosting'], observations).state, 'unsupported')
  observations[1] = { id: 'chat', source: 'server', state: 'supported', evidence: 'Server advertises the feature.' }
  assert.equal(resolveCapability('chat', ['browser', 'server'], observations).state, 'supported')
})
