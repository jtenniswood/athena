import { createBuildModuleLoader } from './renderer-adapter.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

const root = path.resolve('apps/web-desktop')
const pluginFile = path.join(root, 'build/renderer/browser-plugin.ts')
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true
} }).outputText
const plugin = { exports: createBuildModuleLoader().load(pluginFile) }
const original = readFileSync('apps/desktop/src/plugins/hermes-bots/canonical-group-registry.tsx', 'utf8')
const source = plugin.exports.removeBrowserGatewayGroupsRefresh(original, root)

// Execute the adapted component with controlled hook commits to exercise the
// socket publication gap, reconnect and late replies without a live gateway.
function groupList() {
  const state = { connectionId: { value: 'local' }, profile: { value: 'default' }, gateway: { value: 'idle' } }
  state.gateway.get = () => state.gateway.value
  const socket = { value: null }
  const values = [], requests = []
  let cursor, dependencies, cleanup, effect, refresh = 0, completed = 0
  const finishRefresh = () => { completed++ }
  const realm = vm.createContext({ exports: {}, Error, require: name => {
    if (name === '@hermes/plugin-sdk') return {
      atom: value => ({ get: () => value, set: next => { value = next } }),
      host: { state }, useValue: atom => atom.value ?? atom.get?.(), Button: 'button'
    }
    if (name === './canonical-group-labels') return { useCanonicalGroupLabels: () => ({}) }
    if (name === './canonical-group-row') return { CanonicalGroupRow: 'row' }
    if (name === './group-panes') return { closeGroupChatMainTab() {} }
    if (name === '@/store/gateway') return { $gateway: socket }
    if (name.endsWith('/browser-bots-refresh')) return { useBotsRefreshSignal: () => [refresh, finishRefresh] }
    if (name === './canonical-groups') return {
      captureCanonicalGroupRoute: () => ({ connectionId: state.connectionId.value, profile: state.profile.value }),
      discoverCanonicalGroups: route => new Promise((resolve, reject) => requests.push({ route, resolve, reject }))
    }
    if (name === 'react') return {
      useState: initial => {
        const index = cursor++
        if (!(index in values)) values[index] = initial
        return [values[index], value => { values[index] = value }]
      },
      useEffect: (run, deps) => {
        if (!dependencies || deps.some((value, index) => value !== dependencies[index])) {
          effect = run; dependencies = deps
        }
      }
    }
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
    throw new Error(`Unexpected import: ${name}`)
  } })
  vm.runInContext(compile(source), realm)
  return { state, socket, values, requests,
    render() { cursor = 0; realm.exports.CanonicalGroupList({ onOpen() {} }); if (effect) { cleanup?.(); cleanup = effect(); effect = null } },
    refresh() { refresh++ }, completed: () => completed
  }
}
const settle = () => new Promise(resolve => setImmediate(resolve))

test('groups wait for a live socket and recover after reconnect without stale errors or replies', async () => {
  const list = groupList()
  list.render()
  assert.equal(list.requests.length, 0)
  list.state.gateway.value = 'open'
  list.render()
  assert.equal(list.requests.length, 0, 'open state alone does not mean the socket is published')
  list.socket.value = {}
  list.render()
  assert.equal(list.requests.length, 1)
  list.requests[0].reject(new Error('Hermes gateway unavailable'))
  await settle()
  assert.equal(list.values[1], 'Hermes gateway unavailable', 'real request errors remain visible')
  list.state.gateway.value = 'closed'
  list.render()
  assert.equal(list.values[1], '')
  list.state.gateway.value = 'open'
  list.render()
  assert.equal(list.requests.length, 2, 'reconnect retries the group lookup')
  list.requests[1].resolve({ rooms: [{ room_id: 'team', name: 'Team' }] })
  await settle()
  assert.equal(list.values[0][0].name, 'Team')
  list.refresh(); list.render()
  assert.equal(list.requests.length, 3, 'pull-to-refresh still loads groups')
  list.state.profile.value = 'other'
  list.render()
  list.requests[2].reject(new Error('Stale failure'))
  list.requests[3].resolve({ rooms: [{ room_id: 'other', name: 'Other' }] })
  await settle()
  assert.equal(list.values[1], '')
  assert.equal(list.values[0][0].name, 'Other')
  list.state.gateway.value = 'closed'; list.render()
  const before = list.completed()
  list.refresh(); list.render()
  assert.equal(list.completed(), before + 1, 'offline refresh settles without a request')
  assert.equal(list.requests.length, 4)
})
