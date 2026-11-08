import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

function adapter() {
  const stores = {
    $activeSessionId: { value: 'runtime-a' },
    $sessionResumeRequest: { value: null },
    $activeGatewayProfile: { value: 'default' },
    $sessionStates: { value: { 'runtime-a': { storedSessionId: 'chat-a', busy: true,
      usage: { context_used: 444100, context_max: 1000000 } } } }
  }
  let options
  let breakdown = null
  const requests = []
  const dependencies = {
    ...stores, useCallback: callback => callback, useStore: store => store.value,
    useStoreSelector: (store, select) => select(store.value),
    getApiRequestConnection: () => 'primary',
    requestGatewayForAgent: async (...args) => { requests.push(args); return {} },
    useContextBreakdown: next => { options = next; return { breakdown, loading: false } }
  }
  const context = { exports: {}, require: () => dependencies }
  vm.runInNewContext(ts.transpileModule(readFileSync('apps/web-desktop/src/upstream/context-usage.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText, context)
  return {
    stores, requests, options: () => options,
    setBreakdown: value => { breakdown = value },
    read: (changes = {}) => context.exports.useBrowserContextUsage({
      sessionId: 'chat-a', status: 'ready', profile: 'default', connectionId: 'primary', ...changes
    })
  }
}

test('switching chats drops the previous runtime usage before the new runtime binds', () => {
  const ui = adapter()
  assert.equal(ui.read().used, 444100)
  assert.equal(ui.options().busy, true)
  assert.equal(ui.read({ sessionId: 'chat-b' }).used, null)
  assert.equal(ui.options().sessionId, 'chat-b')
  assert.equal(ui.options().busy, false)
  ui.stores.$activeSessionId.value = 'runtime-b'
  ui.stores.$sessionStates.value['runtime-b'] = {
    storedSessionId: 'chat-b', busy: true, usage: { context_used: 12000, context_max: 200000 }
  }
  assert.equal(ui.read({ sessionId: 'chat-b' }).used, 12000)
})

test('context requests retain the selected connection and target profile', async () => {
  const ui = adapter()
  ui.stores.$sessionResumeRequest.value = {
    sessionId: 'chat-a', ownerRoute: { connectionId: 'remote', profile: 'writer', targetProfile: 'agent' }
  }
  ui.read({ profile: 'writer', connectionId: 'remote' })
  await ui.options().requestGateway('session.context_breakdown', { session_id: 'runtime-a' })
  const [connection, profile, method, params] = ui.requests[0]
  assert.equal(connection, 'remote')
  assert.equal(profile, 'writer')
  assert.equal(method, 'session.context_breakdown')
  assert.equal(params.profile, 'agent')
})

test('resumed estimates replace usage and missing capacity never becomes zero percent', () => {
  const ui = adapter()
  ui.setBreakdown({ context_used: 30000, context_max: 200000, context_estimated: true })
  assert.equal(ui.read().used, 30000)
  assert.equal(ui.read().estimated, true)
  ui.setBreakdown({ context_used: 0, context_max: 0 })
  assert.equal(ui.read().used, 444100)
  ui.stores.$sessionStates.value['runtime-a'].usage = { total: 900000 }
  assert.equal(ui.read().capacity, null)
  ui.stores.$sessionStates.value['runtime-a'].usage = { context_used: 0, context_max: 200000 }
  assert.equal(ui.read().used, 0)
})
