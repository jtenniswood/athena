import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

function harness({ all = true, route = { connectionId: 'web-single', profile: 'research' }, profiles = ['default', 'research'], fail = false } = {}) {
  const calls = []
  const dependencies = {
    $activeGatewayProfile: { get: () => 'writer' },
    $showAllProfiles: { get: () => all },
    $profiles: { get: () => profiles.map(name => ({ name })) },
    $newChatRoute: { set: value => calls.push(['route', value]) },
    pinNewChatProfile: name => calls.push(['pin', name]),
    ensureGatewayAgent: (connection, profile) => {
      calls.push(['open', connection, profile])
      return fail ? Promise.reject(new Error('offline')) : Promise.resolve()
    },
    browserDefaultProfile: { getSnapshot: () => route },
    reportActionFailure: message => calls.push(['error', message])
  }
  const context = vm.createContext({ exports: {}, require: () => dependencies })
  const source = readFileSync('apps/web-desktop/src/upstream/default-session-profile.ts', 'utf8')
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
  return { prepare: context.exports.prepareDefaultNewSession, target: context.exports.defaultNewSessionTarget, calls }
}

test('new sessions in All profiles capture the saved owner before activating its gateway', () => {
  const { prepare, calls } = harness()
  prepare()
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['pin', 'research'], ['route', { connectionId: 'web-single', profile: 'research' }], ['open', 'web-single', 'research']
  ])
})

test('single-profile sessions and missing or deleted defaults retain their existing owner', () => {
  for (const options of [{ all: false }, { route: null }, { profiles: ['default'] }]) {
    const { prepare, target, calls } = harness(options)
    assert.equal(target(), null)
    prepare()
    assert.deepEqual(calls, [['pin', 'writer']])
  }
})

test('a failed default-profile activation reports the error without discarding the captured owner', async () => {
  const { prepare, calls } = harness({ fail: true })
  prepare()
  await Promise.resolve()
  assert.equal(calls[1][1].profile, 'research')
  assert.equal(calls.at(-1)[0], 'error')
})
