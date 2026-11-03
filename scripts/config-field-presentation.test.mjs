import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync('apps/web-desktop/src/upstream/config-field-presentation.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
function field(patch = {}) {
  const changes = [], context = vm.createContext({ exports: {}, require: () => ({}) })
  vm.runInContext(source, context)
  const options = { schemaKey: 'display.example', schema: { type: 'string' }, label: 'Example', description: 'A setting',
    value: '', onChange: value => changes.push(value), parseList: raw => raw.split(',').map(value => value.trim()).filter(Boolean),
    prettyName: value => value.toUpperCase(), emptyLabel: 'None', defaultLabel: 'System default', extended: false, ...patch }
  return { changes, controls: context.exports.configFieldPresentation(options) }
}

test('schema field descriptors retain renderer boolean, number, list and JSON commit semantics', async () => {
  const toggle = field({ schema: { type: 'boolean' }, value: true })
  toggle.controls[0].run()
  assert.deepEqual(toggle.changes, [false])
  const number = field({ schema: { type: 'number' }, value: 2 })
  for (const value of ['', '12.5', 'bad']) number.controls[0].run(value)
  assert.deepEqual(number.changes, [0, 12.5])
  const list = field({ schema: { type: 'list' }, value: ['a', 'b'] })
  assert.equal(list.controls[0].value, 'a, b')
  list.controls[0].run(' c, , d ')
  assert.deepEqual(list.changes, [['c', 'd']])
  const json = field({ value: { keep: true } })
  json.controls[0].run('{bad')
  json.controls[0].run('{"next":true}')
  assert.equal(JSON.stringify(json.changes), '[{"next":true}]')
})

test('schema descriptors preserve closed choices, translated empty values and searchable clear semantics', () => {
  const select = field({ schema: { type: 'select', options: ['', 'choice'] }, optionLabels: { choice: 'Translated choice' } })
  assert.equal(JSON.stringify(select.controls[0].options), '[{"label":"None","value":""},{"label":"Translated choice","value":"choice"}]')
  const searchable = field({ schema: { type: 'select', options: ['', 'Europe/London'], searchable: true, clearable: true } })
  assert.equal(JSON.stringify(searchable.controls[0].options), '[{"label":"System default","value":""},{"label":"Europe/London","value":"Europe/London"}]')
})

test('structured and extension fields retain their existing renderer presentation', () => {
  assert.equal(field({ schemaKey: 'fallback_providers', schema: { type: 'list' } }).controls, null)
  assert.equal(field({ extended: true }).controls, null)
  assert.equal(field({ schema: { type: 'text' }, value: 'Long text' }).controls[0].inputType, 'textarea')
})
