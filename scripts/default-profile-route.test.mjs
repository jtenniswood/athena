import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync('apps/web-desktop/src/platform/default-profile-route.ts', 'utf8')
const context = vm.createContext({ exports: {} })
vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
const { createBrowserDefaultProfileRoute } = context.exports

function setup(initial = null) {
  const values = new Map(initial ? [['hermes-web.default-profile-route.v1', JSON.stringify(initial)]] : [])
  const subscribers = new Set()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  }
  const route = createBrowserDefaultProfileRoute(() => storage, 'web-single', {
    subscribe: listener => {
      subscribers.add(listener)
      return () => subscribers.delete(listener)
    }
  })
  return { route, storage, subscribers }
}

const equalJson = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected))

test('browser default profile route persists on the configured gateway and notifies this tab', async () => {
  const { route } = setup()
  const changes = []
  const unsubscribe = route.onDefaultChanged(value => changes.push(value))

  assert.equal(await route.getDefault(), null)
  equalJson(await route.setDefault({ connectionId: null, profile: '  research  ' }), {
    connectionId: 'web-single', profile: 'research'
  })
  equalJson(await route.getDefault(), { connectionId: 'web-single', profile: 'research' })
  assert.equal(changes.length, 1)

  unsubscribe()
  const secondUnsubscribe = route.onDefaultChanged(() => {})
  assert.equal(typeof secondUnsubscribe, 'function')
  secondUnsubscribe()
})

test('browser default profile route ignores another connection and observes other tabs', async () => {
  const { route, subscribers } = setup()
  const changes = []
  const unsubscribe = route.onDefaultChanged(value => changes.push(value))
  const notify = [...subscribers][0]

  notify('other-key', JSON.stringify({ connectionId: 'web-single', profile: 'ignored' }))
  notify('hermes-web.default-profile-route.v1', JSON.stringify({ connectionId: 'remote', profile: 'wrong' }))
  notify('hermes-web.default-profile-route.v1', JSON.stringify({ connectionId: null, profile: 'writer' }))
  notify(null, null)

  equalJson(changes, [
    { connectionId: 'web-single', profile: 'writer' },
    null
  ])
  await assert.rejects(route.setDefault({ connectionId: 'remote', profile: 'writer' }), /configured gateway/)
  unsubscribe()
})

test('browser default profile route treats malformed saved values as unset and reports failed writes', async () => {
  const { route, storage } = setup()
  storage.getItem = () => '{invalid'
  assert.equal(await route.getDefault(), null)
  storage.setItem = () => { throw new Error('storage unavailable') }

  await assert.rejects(route.setDefault({ connectionId: 'web-single', profile: 'research' }), /storage unavailable/)
})
