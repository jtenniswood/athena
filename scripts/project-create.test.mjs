import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'
import { createBuildModuleLoader } from './renderer-adapter.mjs'

test('profile project dialogs wait for activation and ignore superseded or failed opens', async () => {
  let profile = 'default', opened = 0
  const pending = [], errors = []
  const context = vm.createContext({ exports: {}, require: specifier => ({
    '@/store/gateway': { activeGatewayConnectionId: () => 'web' },
    '@/store/notifications': { notifyError: error => errors.push(error.message) },
    '@/store/profile': { $activeGatewayProfile: { get: () => profile },
      ensureGatewayAgent: (_connection, target) => new Promise((resolve, reject) => pending.push({
        resolve: () => { profile = target; resolve() }, reject
      })) },
    '@/store/projects': { openProjectCreate: () => { opened++ } },
    '../platform/connection': { WEB_CONNECTION_ID: 'web' }
  })[specifier] })
  vm.runInContext(ts.transpileModule(readFileSync('apps/web-desktop/src/upstream/project-create.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, context)
  const first = context.exports.openBrowserProfileProjectCreate('research')
  const second = context.exports.openBrowserProfileProjectCreate('writer')
  assert.equal(opened, 0)
  pending[0].resolve(); await first
  assert.equal(opened, 0)
  pending[1].resolve(); await second
  assert.equal(opened, 1)
  const failed = context.exports.openBrowserProfileProjectCreate('research')
  pending[2].reject(new Error('Connection unavailable')); await failed
  assert.equal(opened, 1)
  assert.deepEqual(errors, ['Connection unavailable'])
})

test('project creation retains its dialog profile and rejects a changed owner before writing', async () => {
  const root = path.resolve('apps/web-desktop')
  const { useBrowserProjectCreateOwner } = createBuildModuleLoader().load(path.join(root, 'build/renderer/transforms/project-create.ts'))
  const source = useBrowserProjectCreateOwner(readFileSync('apps/desktop/src/store/projects.ts', 'utf8'))
  const tree = ts.createSourceFile('projects.ts', source, ts.ScriptTarget.Latest, true)
  const names = ['openProjectCreate', 'activeProjectsContext', 'stillOnWritableProjectOwner', 'createProject']
  const functions = tree.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(tree)).join('\n')
  let profile = 'research', state, reconnect
  const writes = []
  const gateway = { connectionState: 'open' }
  const context = vm.createContext({ exports: {},
    $projectsRpcAvailable: { get: () => true }, $projectDialog: { set: next => { state = next } },
    writableProjectProfile: () => profile, normalizeProfileKey: value => value,
    $activeGatewayProfile: { get: () => profile }, activeGatewayConnectionId: () => 'web',
    activeGateway: () => gateway, projectRowOwner: () => ({ connectionId: 'web', stampLocal: false }),
    ensureActiveGatewayOpen: async () => { profile = reconnect; gateway.connectionState = 'open'; return gateway },
    ALL_PROFILES: 'all', isMissingRpcMethod: () => false,
    projectParams: (params, owner) => ({ ...params, profile: owner }),
    gatewayRequestOn: async (_gateway, method, params) => { writes.push([method, params.profile]); return { project: null } },
    markProjectsRpcSuccess() {}, reconcileProjects() {}
  })
  vm.runInContext(ts.transpileModule(functions, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  context.exports.openProjectCreate()
  assert.equal(state.profile, 'research')
  await context.exports.createProject({ name: 'Research project', profile: state.profile })
  assert.deepEqual(writes, [['projects.create', 'research']])
  profile = 'writer'
  await assert.rejects(context.exports.createProject({ name: 'Wrong owner', profile: state.profile }), /profile changed/)
  profile = 'research'; gateway.connectionState = 'closed'; reconnect = 'writer'
  await assert.rejects(context.exports.createProject({ name: 'Reconnect race', profile: state.profile }), /profile changed/)
  assert.equal(writes.length, 1)
})
