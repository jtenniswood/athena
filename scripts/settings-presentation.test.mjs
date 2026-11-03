import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync('apps/web-desktop/src/platform/settings-presentation.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
function load() {
  const context = vm.createContext({ exports: {} })
  vm.runInContext(source, context)
  return context.exports
}

test('settings descriptors project current values and execute only current enabled owner commands', async () => {
  const { createSettingsDescriptor } = load()
  const calls = []
  let rows = [{ id: 'name', kind: 'input', label: 'Display name', value: 'Original', run: value => calls.push(value) }]
  const descriptor = createSettingsDescriptor(() => rows)
  const id = descriptor.snapshot()[0].id
  assert.ok(!id.includes('name'), 'bridge IDs are opaque')
  rows = [{ ...rows[0], value: 'Latest' }]
  assert.equal(descriptor.snapshot()[0].value, 'Latest')
  assert.equal(descriptor.snapshot()[0].id, id)
  await descriptor.invoke(id, 'Updated')
  rows = [{ ...rows[0], disabled: true }]
  await descriptor.invoke(id, 'Disabled')
  rows = []
  await descriptor.invoke(id, 'Removed')
  assert.deepEqual(calls, ['Updated'])
})

test('settings descriptors reject stale owners, disabled choices, invalid input and oversized snapshots', async () => {
  const { createSettingsDescriptor } = load()
  const values = []
  const rows = [{ id: 'choice', kind: 'select', label: 'Theme', options: [{ label: 'Light', value: 'light' },
    { label: 'Blocked', value: 'blocked', disabled: true }], run: value => values.push(value) }]
  const first = createSettingsDescriptor(() => rows), second = createSettingsDescriptor(() => rows)
  const id = first.snapshot()[0].id
  for (const value of [undefined, {}, 'blocked', 'unknown', 'x'.repeat(131073)]) await first.invoke(id, value)
  await second.invoke(id, 'light')
  await first.invoke(id, 'light')
  assert.deepEqual(values, ['light'])
  assert.throws(() => createSettingsDescriptor(() => [...rows, ...rows]).snapshot(), /Unsupported/)
  assert.throws(() => createSettingsDescriptor(() => [{ ...rows[0], value: 'x'.repeat(131073) }]).snapshot(), /Unsupported/)
  assert.throws(() => createSettingsDescriptor(() => Array(1001).fill({ kind: 'text', label: 'Text' })).snapshot(), /large/)
})

test('native projection excludes callbacks, masked secrets and unknown properties', () => {
  const { createSettingsDescriptor } = load()
  const rows = createSettingsDescriptor(() => [{ id: 'secret', kind: 'input', label: 'Secret', inputType: 'password',
    value: 'never-copy-secret', privateValue: 'also-private', run() {} }]).snapshot()
  const serialized = JSON.stringify(rows)
  assert.ok(!serialized.includes('never-copy-secret'))
  assert.ok(!serialized.includes('also-private'))
  assert.ok(!serialized.includes('run'))
  const select = createSettingsDescriptor(() => [{ id: 'choice', kind: 'select', label: 'Choice',
    options: [{ label: 'Public label', value: 'public', privateValue: 'private-option' }] }]).snapshot()
  assert.ok(!JSON.stringify(select).includes('private-option'))
})

test('a field type change invalidates its previous native editor command', async () => {
  const { createSettingsDescriptor } = load(), calls = []
  let row = { id: 'same-field', kind: 'input', inputType: 'text', label: 'Value', run: value => calls.push(value) }
  const descriptor = createSettingsDescriptor(() => [row])
  const previous = descriptor.snapshot()[0].id
  row = { ...row, kind: 'toggle', run: () => calls.push('toggle') }
  await descriptor.invoke(previous, 'stale text')
  assert.deepEqual(calls, [])
  const current = descriptor.snapshot()[0].id
  assert.notEqual(current, previous)
  await descriptor.invoke(current)
  assert.deepEqual(calls, ['toggle'])
})

test('replaced settings registrations survive older cleanup and publish committed frame scopes', () => {
  const api = load(), element = {}, notifications = []
  const stop = api.subscribeSettingsPresentation(() => notifications.push(true))
  const first = api.createSettingsDescriptor(() => []), second = api.createSettingsDescriptor(() => [])
  const releaseFirst = api.registerSettingsDescriptor(element, first)
  const releaseSecond = api.registerSettingsDescriptor(element, second)
  releaseFirst()
  assert.equal(api.settingsDescriptor(element), second)
  let frame = { scope: 'profile-A', title: 'Settings', close() {}, back() {} }
  const releaseFrame = api.registerSettingsFrame(element, () => frame)
  frame = { ...frame, scope: 'profile-B' }
  assert.equal(api.settingsFrameDescriptor(element).scope, 'profile-B')
  releaseFrame(); releaseSecond(); stop()
  assert.equal(api.settingsDescriptor(element), undefined)
  assert.equal(api.settingsFrameDescriptor(element), undefined)
  assert.ok(notifications.length > 3)
})
