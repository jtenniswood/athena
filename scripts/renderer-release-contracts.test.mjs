import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'
const file = new URL('../apps/web-desktop/src/upstream/transforms.ts', import.meta.url)
const context = vm.createContext({ exports: {}, require: createRequire(file) })
vm.runInContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, context)
function transformed(module) {
  const file = new URL('../apps/desktop/src/' + module, import.meta.url)
  return context.exports.transformRenderer(readFileSync(file, 'utf8'), file.pathname).code
}
test('shared browser routes reuse the primary without asking the native backend', async () => {
  const output = transformed('store/gateway-shared-route.ts')
  const realm = vm.createContext({ exports: {}, require: () => ({}), window: { __HERMES_WEB_BRIDGE__: true, hermesDesktop: { getConnection() { throw Error('Unexpected native route lookup') } } } })
  vm.runInContext(ts.transpileModule(output, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, realm)
  assert.equal(await realm.exports.sharedPrimaryRoute('writer'), true)
  realm.window.__HERMES_WEB_BRIDGE__ = false
  assert.equal(await realm.exports.sharedPrimaryRoute('writer'), false)
})
test('connection preference listener tolerates an absent previous snapshot', () => {
  const output = transformed('store/connections.ts')
  const ast = ts.createSourceFile('connections.ts', output, ts.ScriptTarget.Latest, true)
  const listener = ast.statements.find(node => node.getText(ast).startsWith('$lastProfileByConnection.listen('))
  let callback
  const calls = []
  vm.runInNewContext(ts.transpileModule(listener.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    $lastProfileByConnection: { listen: next => { callback = next } },
    window: { hermesDesktop: { profile: { rememberConnection: (...args) => { calls.push(args); return Promise.resolve() } } } }
  })
  callback({ first: 'writer' }, undefined)
  callback({ first: 'writer', second: 'reader' }, { first: 'writer' })
  assert.deepEqual(calls, [['first', 'writer'], ['second', 'reader']])
})
