import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { inspectRenderer, inspectionArguments, writeRendererInspection } from './inspect-renderer.mjs'
import { createRendererAdapter } from './renderer-adapter.mjs'
import { registryPath } from './compatibility-registry.mjs'
import { repositoryRoot, rendererLock } from './renderer.mjs'

const hash = content => createHash('sha256').update(content).digest('hex')

test('inspection emits the exact shared adapter output and distinguishes module replacements', t => {
  const registryBefore = readFileSync(registryPath, 'utf8')
  const inspection = inspectRenderer({ entries: ['browser-settings-controller', 'browser-overlay-return-focus', 'browser-timeline-scrubbing', 'browser-dialog-boundary'] })
  const root = path.join(repositoryRoot, 'apps/web-desktop')
  const adapter = createRendererAdapter(root)
  assert.equal(inspection.manifest.modules.length, 4)
  assert.equal(inspection.manifest.rendererRevision, rendererLock().rev)
  assert.equal(inspection.manifest.registryHash, hash(registryBefore))
  assert.equal(inspection.manifest.dependencyLockHash, hash(readFileSync('pnpm-lock.yaml')))
  for (const module of inspection.manifest.modules) {
    const original = inspection.files[module.originalFile], adapted = inspection.files[module.adaptedFile]
    assert.equal(adapted, adapter.transform(original, path.join(repositoryRoot, 'apps/desktop/src', module.module)))
    assert.equal(module.originalHash, hash(original))
    assert.equal(module.adaptedHash, hash(adapted))
    assert.equal(module.normalizedAdaptedHash, hash(adapted.replaceAll(root, '<web-root>')))
    for (const replacement of module.replacements) {
      assert.equal(inspection.files[replacement.artifact], readFileSync(path.join(repositoryRoot, replacement.source), 'utf8'))
      assert.equal(replacement.sha256, hash(inspection.files[replacement.artifact]))
    }
  }
  const settings = inspection.manifest.modules.find(module => module.module === 'app/settings/index.tsx')
  assert.match(inspection.files[settings.adaptedFile], /function useRendererSettingsController/)
  assert.equal(settings.replacements[0].source, 'apps/web-desktop/src/experience/settings/settings-route.tsx')
  const scoped = inspection.manifest.modules.find(module => module.replacements.some(replacement => replacement.importers))
  assert.ok(scoped, 'scoped replacements must retain their importer restrictions')
  assert.ok(inspection.manifest.adapters.some(adapter => adapter.file.endsWith('/transforms/settings.ts')))
  for (const adapter of inspection.manifest.adapters) assert.equal(adapter.sha256, hash(readFileSync(adapter.file)))

  const temporary = mkdtempSync(path.join(tmpdir(), 'athena-inspection-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const output = path.join(temporary, 'snapshot')
  writeRendererInspection(inspection, output)
  assert.deepEqual(JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8')), inspection.manifest)
  for (const [file, content] of Object.entries(inspection.files)) assert.equal(readFileSync(path.join(output, file), 'utf8'), content)
  assert.throws(() => writeRendererInspection(inspection, output), /EEXIST/)
  assert.equal(readFileSync(registryPath, 'utf8'), registryBefore)
})

test('inspection rejects unknown entries and malformed command options', () => {
  assert.throws(() => inspectRenderer({ entries: ['../unreviewed'] }), /No inspectable renderer module/)
  assert.throws(() => inspectRenderer({ entries: ['browser-runtime-singletons'] }), /No inspectable renderer module/)
  assert.deepEqual(inspectionArguments(['--entry', 'first', '--entry', 'second', '--output', 'new-snapshot']), { entries: ['first', 'second'], output: 'new-snapshot' })
  for (const args of [['--entry'], ['--output'], ['--unknown', 'value'], ['--entry', '--output'], ['--output', 'first', '--output', 'second']]) {
    assert.throws(() => inspectionArguments(args))
  }
})

test('the inspection command refuses existing destinations and fetched renderer directories', t => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'athena-inspection-cli-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const command = ['scripts/inspect-renderer.mjs', '--entry', 'browser-timeline-scrubbing', '--output']
  const failure = spawnSync(process.execPath, [...command, temporary], { encoding: 'utf8' })
  assert.equal(failure.status, 1)
  assert.match(failure.stderr, /must be a new directory/)
  assert.deepEqual(readdirSync(temporary), [])
  const fetched = spawnSync(process.execPath, [...command, path.join(repositoryRoot, 'apps/desktop/inspection-test')], { encoding: 'utf8' })
  assert.equal(fetched.status, 1)
  assert.match(fetched.stderr, /outside fetched renderer/)
  const checkout = path.resolve(realpathSync(path.join(repositoryRoot, 'apps/desktop')), '../..')
  const checkoutWrite = spawnSync(process.execPath, [...command, path.join(checkout, 'inspection-test')], { encoding: 'utf8' })
  assert.equal(checkoutWrite.status, 1)
  assert.match(checkoutWrite.stderr, /outside fetched renderer/)
  const output = path.join(temporary, 'new-output')
  const result = execFileSync(process.execPath, [...command, output], { encoding: 'utf8' })
  assert.match(result, /Inspected 1 renderer modules/)
  assert.equal(JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8')).modules[0].module, 'components/assistant-ui/thread/timeline-rail.tsx')
})
