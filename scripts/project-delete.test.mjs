import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'
import path from 'node:path'
import { createBuildModuleLoader } from './renderer-adapter.mjs'

const context = vm.createContext({ exports: {} })
vm.runInContext(ts.transpileModule(readFileSync('apps/web-desktop/src/upstream/project-owner.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, context)
const { browserProjectOwnerProfile } = context.exports

test('project deletion resolves the exact id across profiles including empty projects', async () => {
  const calls = []
  const gateway = { request: async (method, params) => {
    calls.push([method, params.profile])
    return { projects: params.profile === 'writer' ? [{ id: 'p_target', name: 'test', folders: [] }] : [{ id: 'p_other', name: 'test' }] }
  } }
  assert.equal(await browserProjectOwnerProfile(gateway, 'p_target', ['default', 'writer', 'writer']), 'writer')
  assert.deepEqual(calls, [['projects.list', 'default'], ['projects.list', 'writer']])
})

test('project deletion refuses missing or ambiguous ownership and failed reads', async () => {
  await assert.rejects(browserProjectOwnerProfile({ request: async () => ({ projects: [] }) }, 'p_target', ['default']), /could not be found/)
  await assert.rejects(browserProjectOwnerProfile({ request: async () => ({ projects: [{ id: 'p_target' }] }) }, 'p_target', ['default', 'writer']), /multiple profiles/)
  await assert.rejects(browserProjectOwnerProfile({ request: async (_method, { profile }) => {
    if (profile === 'default') throw new Error('Profile unavailable')
    return { projects: [{ id: 'p_target' }] }
  } }, 'p_target', ['default', 'writer']), /Profile unavailable/)
})

test('combined project edits resolve their saved owner and reject profile changes before writing', async () => {
  const root = path.resolve('apps/web-desktop')
  const { useBrowserProjectDeleteOwner } = createBuildModuleLoader().load(path.join(root, 'build/renderer/transforms/navigation.ts'))
  const source = useBrowserProjectDeleteOwner(readFileSync('apps/desktop/src/store/projects.ts', 'utf8'), root)
  const tree = ts.createSourceFile('projects.ts', source, ts.ScriptTarget.Latest, true)
  const names = ['browserProjectWriteContext', 'updateProject', 'renameProject', 'addProjectFolder', 'setActiveProject']
  const functions = tree.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(tree)).join('\n')
  let activeProfile = 'default', changedDuringRead = false
  const writes = []
  const store = { get: () => [], set: () => {} }
  const gateway = { request: async (_method, { profile }) => {
    if (changedDuringRead) activeProfile = 'writer'
    return { projects: profile === 'research' ? [{ id: 'p_target' }] : [] }
  } }
  const context = vm.createContext({ exports: {}, browserProjectOwnerProfile,
    activeProjectsContext: async profile => ({ profile, gateway }), writableProjectProfile: () => activeProfile,
    viewingAllProfiles: () => true, stillOnWritableProjectOwner: context => context.profile === activeProfile,
    $profiles: { get: () => [{ name: 'default' }, { name: 'research' }] },
    $projectTree: store, $projects: store, $activeProjectId: { set: () => { throw new Error('Sibling active project leaked') } },
    snapshotProjects: () => ({ tree: [], projects: [] }), persistOrRollback: async (_snap, write) => write(),
    projectParams: (params, profile) => ({ ...params, profile }), reconcileProjects() {},
    gatewayRequestOn: async (_gateway, method, params) => { writes.push([method, params.profile, params.id]); return { active_id: params.id } }
  })
  vm.runInContext(ts.transpileModule(functions, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  await context.exports.renameProject('p_target', 'Renamed')
  await context.exports.updateProject('p_target', { color: 'blue' })
  await context.exports.addProjectFolder('p_target', '/workspace/extra')
  await context.exports.setActiveProject('p_target')
  assert.deepEqual(writes, ['projects.update', 'projects.update', 'projects.add_folder', 'projects.set_active'].map(method => [method, 'research', 'p_target']))
  changedDuringRead = true
  await assert.rejects(context.exports.renameProject('p_target', 'Too late'), /profile changed/)
  assert.equal(writes.length, 4)
})
