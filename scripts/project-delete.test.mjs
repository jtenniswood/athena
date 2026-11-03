import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

const context = vm.createContext({ exports: {} })
vm.runInContext(ts.transpileModule(readFileSync('apps/web-desktop/src/upstream/project-delete.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, context)
const { browserProjectDeleteProfile } = context.exports

test('project deletion resolves the exact id across profiles including empty projects', async () => {
  const calls = []
  const gateway = { request: async (method, params) => {
    calls.push([method, params.profile])
    return { projects: params.profile === 'writer' ? [{ id: 'p_target', name: 'test', folders: [] }] : [{ id: 'p_other', name: 'test' }] }
  } }
  assert.equal(await browserProjectDeleteProfile(gateway, 'p_target', ['default', 'writer', 'writer']), 'writer')
  assert.deepEqual(calls, [['projects.list', 'default'], ['projects.list', 'writer']])
})

test('project deletion refuses missing or ambiguous ownership and failed reads', async () => {
  await assert.rejects(browserProjectDeleteProfile({ request: async () => ({ projects: [] }) }, 'p_target', ['default']), /could not be found/)
  await assert.rejects(browserProjectDeleteProfile({ request: async () => ({ projects: [{ id: 'p_target' }] }) }, 'p_target', ['default', 'writer']), /multiple profiles/)
  await assert.rejects(browserProjectDeleteProfile({ request: async (_method, { profile }) => {
    if (profile === 'default') throw new Error('Profile unavailable')
    return { projects: [{ id: 'p_target' }] }
  } }, 'p_target', ['default', 'writer']), /Profile unavailable/)
})
