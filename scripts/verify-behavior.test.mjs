import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { behaviorDependencies, selectBehavior, behaviorPlan, verifyObserved, browserObservations, executeBehavior, parseBehaviorArgs, previousRegistry } from './verify-behavior.mjs'
import { registryPath } from './compatibility-registry.mjs'
import { execFileSync } from 'node:child_process'

test('behavior comparison reads registries from either side of the build-directory migration', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'athena-registry-history-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-q')
  const commit = () => {
    git('add', '.')
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Registry fixture')
    return git('rev-parse', 'HEAD')
  }
  const oldPath = 'apps/web-desktop/src/upstream/compatibility-registry.json'
  mkdirSync(path.dirname(path.join(root, oldPath)), { recursive: true })
  writeFileSync(path.join(root, oldPath), JSON.stringify([{ name: 'old' }]))
  const old = commit()
  mkdirSync(path.dirname(path.join(root, registryPath)), { recursive: true })
  writeFileSync(path.join(root, registryPath), JSON.stringify([{ name: 'current' }]))
  const current = commit()
  assert.deepEqual(previousRegistry(old, root), [{ name: 'old' }])
  assert.deepEqual(previousRegistry(current, root), [{ name: 'current' }])
  writeFileSync(path.join(root, registryPath), 'malformed')
  assert.throws(() => previousRegistry(commit(), root), SyntaxError)
})

const entry = (name, file = 'scripts/example.test.mjs', scenario = 'declared scenario') => ({ name, owner: `src/${name}.ts`, tests: [{ file, scenario }] })

test('behavior selection follows changed and removed entries without selecting unrelated registry edits', () => {
  const a = entry('selection'), b = entry('settings'), removed = entry('retired')
  const changed = { ...a, reason: 'Changed behavior' }
  assert.deepEqual(selectBehavior([changed, b], { changed: [registryPath], previous: [a, b, removed] }).map(e => e.name), ['selection', 'retired'])
  assert.deepEqual(selectBehavior([a, b], { entries: ['settings'] }).map(e => e.name), ['settings'])
  assert.deepEqual(selectBehavior([a, b], { changed: ['unrelated.css'] }), [])
  assert.equal(selectBehavior([a, b], { changed: ['flake.lock'] }).length, 2)
  assert.throws(() => selectBehavior([a], { entries: ['typo'] }), /Unknown/)
})

test('behavior dependencies follow wrapper imports, cycles and injected paths through replacement modules', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'athena-behavior-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(path.join(root, 'apps/web-desktop/src'), { recursive: true })
  const put = (file, body) => writeFileSync(path.join(root, 'apps/web-desktop/src', file), body)
  put('owner.ts', "import './shared'; const adapter = path.join(root, 'src/commands');")
  put('shared.ts', "export * from './owner'")
  put('commands.ts', 'export const command = true')
  const dependencies = behaviorDependencies('apps/web-desktop/src/owner.ts', root)
  assert.ok(dependencies.has('apps/web-desktop/src/commands.ts'))
  assert.ok(dependencies.has('apps/web-desktop/src/shared.ts'))
  const e = { ...entry('root'), replacement: 'src/owner.ts' }
  assert.deepEqual(selectBehavior([e], { root, changed: ['apps/web-desktop/src/commands.ts'] }).map(e => e.name), ['root'])
})

test('plans distinguish explicit runner scope from deferred upstream references and browser scenarios', () => {
  const entries = [entry('a'), entry('b'), entry('browser', 'tests/browser/example.spec.mjs'), entry('upstream', 'apps/desktop/source.test.tsx')]
  const plan = behaviorPlan(entries, 'node')
  assert.equal(plan.requested.length, 1, 'duplicate declared references execute once')
  assert.equal(plan.deferred.length, 2)
  assert.equal(plan.status, 'planned')
  assert.throws(() => behaviorPlan(entries, 'unknown'), /runner/)
  assert.throws(() => parseBehaviorArgs(['--entry']), /Missing/)
  assert.throws(() => parseBehaviorArgs([]), /Choose/)
  assert.throws(() => parseBehaviorArgs(['--all']), /Unknown/)
})

test('execution evidence must match the requested file and scenario and cannot count skips or expected failures', () => {
  const reference = entry('a').tests[0]
  for (const observed of [[], [{ ...reference, name: reference.scenario, status: 'skipped' }], [{ file: 'other.mjs', name: reference.scenario, status: 'passed' }]]) {
    assert.equal(verifyObserved([reference], observed).length, 1)
  }
  assert.equal(verifyObserved([reference], [{ file: reference.file, name: 'suite: ' + reference.scenario, status: 'passed' }]).length, 0)
  const results = browserObservations({ suites: [{ suites: [{ file: 'test.mjs', specs: [{ title: reference.scenario, tests: [{ expectedStatus: 'failed', results: [{ status: 'failed' }] }] }] }] }] })
  assert.equal(results[0].status, 'failed')
  const browser = browserObservations({ config: { rootDir: '/repo/tests/browser' }, suites: [{ file: 'test.spec.mjs', specs: [{ title: reference.scenario, tests: [{ expectedStatus: 'passed', results: [{ status: 'passed' }] }] }] }] })
  assert.equal(browser[0].file, '/repo/tests/browser/test.spec.mjs')
})

test('the actual Node runner executes literal scenario names and fails when a requested scenario was skipped', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'athena-behavior-execution-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(path.join(root, 'scripts'))
  copyFileSync(new URL('./behavior-reporter.mjs', import.meta.url), path.join(root, 'scripts/behavior-reporter.mjs'))
  writeFileSync(path.join(root, 'scripts/example.test.mjs'), "import {test} from 'node:test'; test('literal [a]+ scenario',()=>{}); test('skipped scenario',{skip:true},()=>{}); test('unrelated',()=>{throw Error('must not run')})")
  const requested = entry('literal', 'scripts/example.test.mjs', 'literal [a]+ scenario')
  const passed = executeBehavior(behaviorPlan([requested], 'node'), root)
  assert.equal(passed.status, 'passed', JSON.stringify(passed))
  assert.deepEqual(passed.observed.map(test => test.name), ['literal [a]+ scenario'])
  const skipped = executeBehavior(behaviorPlan([entry('skipped', 'scripts/example.test.mjs', 'skipped scenario')], 'node'), root)
  assert.equal(skipped.status, 'failed')
  assert.equal(skipped.missing.length, 1)
})
