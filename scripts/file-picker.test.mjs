import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

const compile = file => ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
function fixture() {
  const timers = new Map(), nodes = new Set()
  let nextTimer = 0
  class Input {
    value = ''; files = []; style = {}; listeners = new Map()
    click() { this.open?.() }
    addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener) }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener) }
    emit(type) { for (const listener of [...this.listeners.get(type) || []]) listener() }
    remove() { nodes.delete(this) }
    get listenerCount() { return [...this.listeners.values()].reduce((sum, values) => sum + values.size, 0) }
  }
  const safetyContext = vm.createContext({ exports: {}, window: { localStorage: { getItem: () => '{}' } },
    require: name => name === './pending-work' ? { flushPendingBrowserWork: async () => ({ ready: true }) } : {
      browserDraftSnapshot: () => ({ blocked: false, storageKey: 'drafts', texts: {}, attachments: 0 }), flushBrowserDrafts: async () => {}
    } })
  vm.runInContext(compile('apps/web-desktop/src/platform/reload-safety.ts'), safetyContext)
  const safety = safetyContext.exports
  safety.setActiveWork({ count: 0 })
  const context = vm.createContext({ exports: {},
    document: { createElement: () => new Input(), body: { appendChild: input => nodes.add(input) } },
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer }, clearTimeout: id => timers.delete(id),
    require: () => ({ beginOperation: safety.beginOperation, servingBase: () => '' }) })
  vm.runInContext(compile('apps/web-desktop/src/platform/files.ts'), context)
  return { ...context.exports, Input, timers, nodes, ready: () => safety.reloadReadiness(false).ready,
    holdOtherOperation: safety.beginOperation, expire() { for (const callback of [...timers.values()]) callback() } }
}

test('failed picker opening cleans its listeners and operation before a retry', async () => {
  const app = fixture(), input = new app.Input()
  input.open = () => { throw new Error('Picker refused') }
  await assert.rejects(app.pickWithInput(input), /Picker refused/)
  assert.equal(input.listenerCount, 0)
  assert.equal(app.timers.size, 0)
  assert.equal(app.ready(), true)
  input.open = undefined
  const retry = app.pickWithInput(input)
  input.files = [{ name: 'retry.txt' }]
  assert.doesNotThrow(() => input.emit('change'))
  assert.deepEqual([...(await retry)], input.files)
  assert.equal(app.ready(), true)
})

test('a new picker cancels its predecessor and keeps the current operation guarded', async () => {
  const app = fixture(), oldInput = new app.Input(), current = new app.Input()
  const old = app.pickWithInput(oldInput), staleTimeout = [...app.timers.values()][0]
  let oldResult
  void old.then(files => { oldResult = files })
  const selected = app.pickWithInput(current)
  await Promise.resolve()
  assert.ok(oldResult, 'The superseded picker must settle before the new one chooses files')
  assert.equal((await old).length, 0)
  assert.equal(oldInput.listenerCount, 0)
  assert.equal(app.ready(), false)
  oldInput.files = [{ name: 'stale.txt' }]
  oldInput.emit('change'); staleTimeout()
  assert.equal(app.ready(), false)
  current.files = [{ name: 'current.txt' }]
  current.emit('change')
  assert.deepEqual([...(await selected)], current.files)
  assert.equal(app.timers.size, 0)
  assert.equal(app.ready(), true)
})

for (const type of ['change', 'cancel']) {
  test(`synchronous ${type} during opening settles once without leaving a timer`, async () => {
    const app = fixture(), input = new app.Input()
    input.files = [{ name: 'chosen.txt' }]
    input.open = () => input.emit(type)
    const files = await app.pickWithInput(input)
    assert.equal(files.length, type === 'change' ? 1 : 0)
    assert.equal(input.listenerCount, 0)
    assert.equal(app.timers.size, 0)
    assert.equal(app.ready(), true)
  })
}

test('cancel and missing-cancel expiry release only their own reload guard', async () => {
  for (const cancel of [input => input.emit('cancel'), (_input, app) => app.expire()]) {
    const app = fixture(), input = new app.Input(), releaseOther = app.holdOtherOperation()
    const selected = app.pickWithInput(input)
    cancel(input, app)
    assert.equal((await selected).length, 0)
    input.emit('change'); input.emit('cancel')
    assert.equal(app.ready(), false)
    releaseOther()
    assert.equal(app.ready(), true)
    assert.equal(input.listenerCount, 0)
    assert.equal(app.timers.size, 0)
  }
})

test('browser requests own separate temporary inputs and retain picker options', async () => {
  const app = fixture()
  assert.equal((await app.pickBrowserFiles({ directories: true })).length, 0)
  assert.equal(app.nodes.size, 0)
  const first = app.pickBrowserFiles({ filters: [{ extensions: ['TXT', 'PNG'] }] })
  const oldInput = [...app.nodes][0]
  assert.equal(oldInput.type, 'file')
  assert.equal(oldInput.multiple, true)
  assert.equal(oldInput.accept, '.txt,.png')
  const second = app.pickBrowserFiles({ multiple: false })
  const current = [...app.nodes].find(input => input !== oldInput)
  assert.equal((await first).length, 0)
  assert.equal(app.nodes.has(oldInput), false)
  assert.equal(current.multiple, false)
  current.files = [{ name: 'current.txt' }]
  current.emit('change')
  assert.deepEqual([...(await second)], current.files)
  assert.equal(app.nodes.size, 0)
  assert.equal(app.ready(), true)
})
