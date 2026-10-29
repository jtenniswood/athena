import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

function harness({ all = true, profiles = ['default', 'research'], order = ['research', 'default'], hidden = [], fail = false } = {}) {
  const calls = []
  const dependencies = {
    $activeGatewayProfile: { get: () => 'writer' },
    $showAllProfiles: { get: () => all },
    $profiles: { get: () => profiles.map(name => ({ name, is_default: name === 'default' })) },
    $profileOrder: { get: () => order },
    sortByProfileOrder: (items, names) => [...items].sort((a, b) => {
      const rank = name => names.includes(name) ? names.indexOf(name) : names.length
      return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)
    }),
    readHiddenProfiles: () => hidden,
    WEB_CONNECTION_ID: 'web-single',
    $newChatRoute: { set: value => calls.push(['route', value]) },
    pinNewChatProfile: name => calls.push(['pin', name]),
    ensureGatewayAgent: (connection, profile) => {
      calls.push(['open', connection, profile])
      return fail ? Promise.reject(new Error('offline')) : Promise.resolve()
    },
    reportActionFailure: message => calls.push(['error', message])
  }
  const context = vm.createContext({ exports: {}, require: () => dependencies })
  const source = readFileSync('apps/web-desktop/src/upstream/default-session-profile.ts', 'utf8')
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
  return { prepare: context.exports.prepareDefaultNewSession, target: context.exports.defaultNewSessionTarget, calls }
}

test('new sessions in All profiles capture the first enabled owner before activating its gateway', () => {
  const { prepare, calls } = harness()
  prepare()
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['pin', 'research'], ['route', { connectionId: 'web-single', profile: 'research' }], ['open', 'web-single', 'research']
  ])
})

test('single-profile sessions and unavailable enabled profiles retain their existing owner', () => {
  for (const options of [{ all: false }, { profiles: [] }, { hidden: ['default', 'research'] }]) {
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

test('All profiles follows rail order, skips hidden profiles and handles stale ordering', () => {
  for (const [options, expected] of [
    [{ order: [] }, 'default'],
    [{ hidden: ['research'] }, 'default'],
    [{ order: ['deleted', 'research'] }, 'default'],
    [{ profiles: ['writer', 'research'], order: ['deleted', 'writer'] }, 'writer'],
    [{ profiles: ['writer', 'research'], order: [] }, 'research']
  ]) {
    assert.equal(harness(options).target()?.profile, expected)
  }
})
