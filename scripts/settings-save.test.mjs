import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

function fixture() {
  const compile = name => ts.transpileModule(readFileSync(new URL(`../apps/web-desktop/src/platform/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const registry = vm.createContext({ exports: {} })
  vm.runInContext(compile('pending-work'), registry)
  const timers = new Map()
  let nextTimer = 0
  const context = vm.createContext({ exports: {}, require: () => registry.exports,
    setTimeout: work => { const id = ++nextTimer; timers.set(id, work); return id },
    clearTimeout: id => timers.delete(id)
  })
  vm.runInContext(compile('settings-save'), context)
  return { create: context.exports.createBrowserSettingsSaveOwner, flush: registry.exports.flushPendingBrowserWork, timers }
}

test('settings preparation starts the latest save without waiting for a debounce timer', async () => {
  const { create, flush, timers } = fixture()
  const owner = create('settings')
  const calls = []
  owner.schedule(async () => { calls.push('superseded') })
  owner.schedule(async () => { calls.push('latest') })
  assert.equal(timers.size, 1)
  assert.equal((await flush()).ready, true)
  assert.deepEqual(calls, ['latest'])
  assert.equal(timers.size, 0)
})

test('settings preparation waits for confirmation and includes an edit made during the save', async () => {
  const { create, flush } = fixture()
  const owner = create('settings')
  let confirm
  const gate = new Promise(resolve => { confirm = resolve })
  const calls = []
  owner.schedule(async () => { calls.push('first'); await gate })
  let ready = false
  const preparing = flush().then(result => { ready = result.ready })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(ready, false)
  owner.schedule(async () => { calls.push('second') })
  confirm()
  await preparing
  assert.equal(ready, true)
  assert.deepEqual(calls, ['first', 'second'])
})

test('a failed settings save blocks preparation until a new confirmed edit replaces it', async () => {
  const { create, flush } = fixture()
  const owner = create('settings')
  owner.schedule(async () => { throw new Error('Gateway rejected the save') })
  const blocked = await flush()
  assert.equal(blocked.ready, false)
  assert.match(blocked.reason, /could not be saved/)
  owner.schedule(async () => {})
  assert.equal((await flush()).ready, true)
})

test('profile changes cancel unsent edits but retain readiness ownership for in-flight saves', async () => {
  const { create, flush, timers } = fixture()
  const owner = create('settings')
  const calls = []
  owner.schedule(async () => { calls.push('unsent') })
  owner.resetScope()
  assert.equal(timers.size, 0)
  assert.equal((await flush()).ready, true)
  assert.deepEqual(calls, [])
  let confirm
  const gate = new Promise(resolve => { confirm = resolve })
  owner.schedule(async () => { calls.push('in-flight'); await gate })
  const preparing = owner.prepare()
  await new Promise(resolve => setImmediate(resolve))
  owner.resetScope()
  let ready = false
  const afterSwitch = flush().then(result => { ready = result.ready })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(ready, false)
  confirm()
  await Promise.all([preparing, afterSwitch])
  assert.equal(ready, true)
  assert.equal(owner.scope, 2)
})
