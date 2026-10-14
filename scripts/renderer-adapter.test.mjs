import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'
import { createRendererAdapter, rendererAdapterPlugin } from './renderer-adapter.mjs'
import { adapterCompilerHost } from './typecheck.mjs'

const root = path.resolve('apps/web-desktop')
const adapter = createRendererAdapter(root)
const options = { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true, noEmit: true }
const hash = code => createHash('sha256').update(code.replaceAll(root, '<web-root>')).digest('hex')

test('the complete adapted graph retains every reviewed final renderer and browser fingerprint', () => {
  const terminal = new Map()
  for (const entry of adapter.registry.filter(entry => ['renderer-transform', 'browser-transform'].includes(entry.kind)).sort((a, b) => a.order - b.order)) terminal.set(entry.module, entry)
  for (const [module, entry] of terminal) {
    const file = path.resolve(root, '../desktop/src', module)
    let output = adapter.transform(readFileSync(file, 'utf8'), file)
    if (entry.kind === 'renderer-transform') output = output.slice(output.indexOf('\n') + 1)
    assert.equal(hash(output), entry.outputHash, entry.name)
  }
})

test('TypeScript checks compiler errors introduced by adapted source instead of the raw source', () => {
  const probe = path.join(root, 'src/experience/contracts/host.ts')
  const checked = { ...adapter, transform(source, file) {
    const output = adapter.transform(source, file)
    return file === probe ? output + '\nconst adapterTypeProbe: string = 42\nimport { missing } from "./missing-adapter-module"\n' : output
  } }
  const program = ts.createProgram([probe], options, adapterCompilerHost(options, checked))
  const diagnostics = ts.getPreEmitDiagnostics(program).filter(d => d.file?.fileName === probe)
  assert.ok(diagnostics.some(d => d.code === 2322), 'adapted type errors must fail')
  assert.ok(diagnostics.some(d => d.code === 2307), 'adapted missing imports must fail')
})

test('compiler and Vite resolve scoped replacements, virtual modules, aliases, and bypass imports identically', async () => {
  const host = adapterCompilerHost(options, adapter)
  const plugin = rendererAdapterPlugin(root)
  const cases = [
    ['@/app/settings', 'app/app.tsx', 'src/experience/settings/settings-route.tsx'],
    ['hermes:settings-controller', 'upstream/settings-controller-api.tsx', '../desktop/src/app/settings/index.tsx'],
    ['@/app/settings/gateway-settings', 'app/settings/index.tsx', 'src/overrides/gateway-settings.tsx'],
    ['./gateway-settings', 'app/settings/index.tsx', 'src/overrides/gateway-settings.tsx'],
    ['@hermes/plugin-sdk', 'plugins/hermes-bots/create-dialog.tsx', 'src/upstream/browser-dialog-sdk.ts'],
    ['@/components/ui/dialog', 'plugins/hermes-bots/create-dialog.tsx', 'src/upstream/browser-dialog.tsx'],
    ['@/components/ui/dialog', 'components/ui/confirm-dialog.tsx', 'src/upstream/browser-dialog.tsx'],
    ['@/app/shell/statusbar-controls', 'upstream/browser-statusbar.tsx', '../desktop/src/app/shell/statusbar-controls.tsx'],
    ['hermes:statusbar-item', 'upstream/browser-statusbar.tsx', '../desktop/src/app/shell/statusbar-controls.tsx']
  ]
  for (const [specifier, importer, target] of cases) {
    const file = importer.startsWith('upstream/') ? path.join(root, 'src', importer) : path.resolve(root, '../desktop/src', importer)
    const compiler = host.resolveModuleNames([specifier], file)[0]
    assert.equal(compiler?.resolvedFileName, path.resolve(root, target), specifier)
    const context = { resolve: async source => {
      const resolved = ts.resolveModuleName(adapter.alias(source), file, options, host).resolvedModule
      return resolved ? { id: resolved.resolvedFileName } : null
    } }
    const vite = await plugin.resolveId.call(context, specifier, file)
    const expected = path.resolve(root, target)
    const raw = (await context.resolve(specifier))?.id
    assert.equal(vite ?? raw, expected, specifier)
  }
})

test('replacement resolution is identical for relative and aliased remote folder picker callers', () => {
  const importer = path.resolve(root, '../desktop/src/app/right-sidebar/files/index.tsx')
  const host = adapterCompilerHost(options, adapter)
  for (const source of ['./remote-picker', '@/app/right-sidebar/files/remote-picker']) {
    assert.equal(host.resolveModuleNames([source], importer)[0]?.resolvedFileName, path.join(root, 'src/overrides/remote-folder-picker.tsx'))
  }
})

test('the shared source graph applies Athena branding without evaluating renderer modules', () => {
  const file = path.resolve(root, '../desktop/src/components/chat/intro.tsx')
  const output = adapter.transform(readFileSync(file, 'utf8'), file)
  assert.match(output, /const WORDMARK = 'ATHENA'/)
  assert.match(output, /const body = 'Athena for Hermes Agent'/)
})
