import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

test('native gateway groups wait for a connection and refresh after local changes without losing cached rooms', async () => {
  const state = { connectionId: 'web-single', profile: 'default', gateway: 'closed' }
  const atoms = Object.fromEntries(Object.keys(state).map(key => [key, { get: () => state[key] }]))
  let query, refreshed = 0
  const refetch = () => { refreshed++ }
  const rooms = [{ key: 'kept', name: 'Kept' }]
  const context = vm.createContext({ exports: {}, console, require: name => {
    if (name === '@hermes/plugin-sdk') return {
      atom: value => ({ get: () => value, set: next => { value = next } }),
      host: { state: atoms }, useValue: atom => atom.get(), useQuery: options => { query = options; return { data: rooms, refetch } }
    }
    if (name === 'react') return { useMemo: fn => fn(), useEffect: fn => fn() }
    if (name === './shared') return { ID: 'bots' }
    return {}
  } })
  const source = readFileSync('apps/desktop/src/plugins/hermes-bots/canonical-group-registry.tsx', 'utf8')
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, context)
  const owner = context.exports
  assert.equal(owner.useGatewayGroupRooms()[0].name, 'Kept')
  assert.equal(query.enabled, false)
  state.gateway = 'open'
  owner.useGatewayGroupRooms()
  assert.equal(query.enabled, true)
  owner.refreshGatewayGroupRooms()
  owner.useGatewayGroupRooms()
  assert.equal(refreshed, 1)
  state.connectionId = ''
  assert.equal(owner.useGatewayGroupRooms().length, 0)
  assert.equal(query.enabled, false)
})
