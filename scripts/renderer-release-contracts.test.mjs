import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'
const file = new URL('../apps/web-desktop/build/renderer/transforms.ts', import.meta.url)
const context = vm.createContext({ exports: {}, require: createRequire(file) })
vm.runInContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, context)
function transformed(module) {
  const file = new URL('../apps/desktop/src/' + module, import.meta.url)
  return context.exports.transformRenderer(readFileSync(file, 'utf8'), file.pathname).code
}
test('shared browser routes reuse the primary without asking the native backend', async () => {
  const output = transformed('store/gateway-shared-route.ts')
  let lookups = 0
  const descriptor = { profile: 'writer', sharedPrimary: true }
  const realm = vm.createContext({
    exports: {},
    require: () => ({ withTimeout: promise => promise }),
    window: { __HERMES_WEB_BRIDGE__: true, hermesDesktop: { getConnection: async () => { lookups++; return descriptor } } }
  })
  vm.runInContext(ts.transpileModule(output, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, realm)
  assert.equal(await realm.exports.sharedPrimaryRoute('writer'), true)
  assert.equal(lookups, 0)
  assert.equal(await realm.exports.sharedPrimaryConnection('writer'), descriptor)
  assert.equal(lookups, 1)
  realm.window.__HERMES_WEB_BRIDGE__ = false
  assert.equal(await realm.exports.sharedPrimaryRoute('writer'), true)
  realm.window.hermesDesktop.getConnection = async () => ({ sharedPrimary: false })
  assert.equal(await realm.exports.sharedPrimaryRoute('writer'), false)
  realm.window.hermesDesktop.getConnection = async () => { throw new Error('Route unavailable') }
  await assert.rejects(realm.exports.sharedPrimaryRoute('writer'), /Route unavailable/)
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
