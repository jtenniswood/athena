import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'
import { createBuildModuleLoader } from './renderer-adapter.mjs'

const root = path.resolve('apps/web-desktop')
const { projectRendererController } = createBuildModuleLoader().load(path.join(root, 'build/renderer/controller.ts'))

test('sidebar view extraction preserves live controller hooks and captured command owners', () => {
  const original = `export function EnginePanel({ owner }: { owner: string }) {
    const selected = useOwner(owner)
    const rows = useRows(selected)
    const decoration = <OldTitle />
    const saveRow = (id: string) => { return save(selected, id) }
    return <OldPanel title={decoration}>{rows}</OldPanel>
  }`
  const source = projectRendererController(original, 'EnginePanel', '<BrowserPanel model={{ owner: selected, rows, saveRow }} />', ['decoration'])
  const calls = [], writes = []
  let rows = ['first']
  const context = vm.createContext({ exports: {}, BrowserPanel: 'browser',
    React: { createElement: (type, props) => ({ type, props }) },
    useOwner: owner => { calls.push(owner); return owner },
    useRows: () => rows, save: (owner, id) => writes.push([owner, id])
  })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, context)
  const first = context.exports.EnginePanel({ owner: 'research' })
  rows = ['second']
  const second = context.exports.EnginePanel({ owner: 'writer' })
  first.props.model.saveRow('shared-id')
  second.props.model.saveRow('shared-id')
  assert.deepEqual(calls, ['research', 'writer'])
  assert.deepEqual(writes, [['research', 'shared-id'], ['writer', 'shared-id']])
  assert.deepEqual(first.props.model.rows, ['first'])
  assert.deepEqual(second.props.model.rows, ['second'])
  assert.equal(first.type, 'browser')
})

test('sidebar view extraction rejects ambiguous returns and removed presentation seams', () => {
  for (const source of [
    'function Different() { return null }',
    'function Panel() {}',
    'function Panel() { return null; return null }'
  ]) assert.throws(() => projectRendererController(source, 'Panel', '<BrowserPanel />'), /controller/)
  assert.throws(() => projectRendererController('function Panel() { return null }', 'Panel', '<BrowserPanel />', ['missing']), /binding/)
})

test('project presentation projection keeps hydration, exclusion and paging with the renderer owner', () => {
  const { useBrowserProjectController } = createBuildModuleLoader().load(path.join(root, 'build/renderer/transforms/sidebar.ts'))
  const original = readFileSync(path.join(root, '../desktop/src/app/chat/sidebar/projects/overview-row.tsx'), 'utf8')
  const output = useBrowserProjectController(original, root)
  assert.match(output, /useWorkspaceNodeOpen\(project.id\)/)
  assert.match(output, /useRevealedRows\(preview, PROJECT_SESSION_PAGE\)/)
  assert.match(output, /excludeProjectSessions\(expanded, isSessionHidden\)/)
  assert.match(output, /fetchBrowserProjectSessions\(project\)/)
  assert.match(output, /BrowserProjectControllerSurface/)
  assert.doesNotMatch(output, /const shell =|const labelLink =|const lead =/)
})
