import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { loadRegistry, registryPath } from './compatibility-registry.mjs'
import { repositoryRoot } from './renderer.mjs'

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const globalInputs = new Set(['flake.lock', 'pnpm-lock.yaml', 'package.json', 'pnpm-workspace.yaml',
  'scripts/renderer-adapter.mjs', 'scripts/aliases.mjs', 'apps/web-desktop/vite.config.ts'])

/** Compare across the build-directory migration without accepting malformed registries. */
export function previousRegistry(commit, root = repositoryRoot) {
  const paths = [registryPath, 'apps/web-desktop/src/upstream/compatibility-registry.json']
  for (const file of paths) {
    const object = `${commit}:${file}`
    if (spawnSync('git', ['cat-file', '-e', object], { cwd: root, stdio: 'ignore' }).status === 0) {
      return JSON.parse(execFileSync('git', ['show', object], { cwd: root, encoding: 'utf8' }))
    }
  }
  throw new Error('The comparison commit contains no renderer compatibility registry')
}

/** Follow wrapper imports and injected wrapper paths without evaluating renderer modules. */
export function behaviorDependencies(owner, root = repositoryRoot) {
  const visited = new Set(), pending = [owner]
  while (pending.length) {
    const file = pending.pop()
    if (visited.has(file)) continue
    visited.add(file)
    if (!/\.(?:[cm]?js|tsx?)$/.test(file) || !existsSync(path.join(root, file))) continue
    const tree = ts.createSourceFile(file, readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true)
    const add = base => {
      const relative = path.relative(root, base).replaceAll('\\', '/')
      if (relative.startsWith('../') || relative.startsWith('apps/desktop/') || relative.startsWith('apps/shared/')) return
      const candidate = [relative, relative + '.ts', relative + '.tsx', relative + '.mjs', relative + '.css', relative + '/index.ts', relative + '/index.tsx']
        .find(name => /\.[a-z]+$/.test(name) && existsSync(path.join(root, name)))
      if (candidate) pending.push(candidate)
    }
    const walk = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('.')) {
        add(path.resolve(root, path.dirname(file), node.moduleSpecifier.text))
      }
      if (ts.isCallExpression(node) && node.expression.getText(tree) === 'path.join' &&
          node.arguments[0]?.getText(tree) === 'root' && node.arguments[1] && ts.isStringLiteral(node.arguments[1]) && node.arguments[1].text.startsWith('src/')) {
        add(path.resolve(root, 'apps/web-desktop', node.arguments[1].text))
      }
      ts.forEachChild(node, walk)
    }
    walk(tree)
  }
  return visited
}

export function selectBehavior(registry, { entries = [], owners = [], changed = [], previous = [], root = repositoryRoot } = {}) {
  for (const name of entries) if (!registry.some(entry => entry.name === name)) throw new Error(`Unknown compatibility entry: ${name}`)
  const files = new Set(changed), all = changed.some(file => globalInputs.has(file))
  const old = new Map(previous.map(entry => [entry.name, entry]))
  const dependencies = new Map()
  // Retired interventions may delete their tests in the same change. Keep any
  // surviving checks, but never filter references belonging to current entries.
  const retired = previous.filter(entry => files.has(registryPath) && !registry.some(current => current.name === entry.name))
    .map(entry => ({ ...entry, tests: entry.tests.filter(test => !files.has(test.file) ||
      (existsSync(path.join(root, test.file)) && readFileSync(path.join(root, test.file), 'utf8').includes(test.scenario))) }))
    .filter(entry => entry.tests.length)
  const candidates = [...registry, ...retired]
  return candidates.filter(entry => {
    if (entries.includes(entry.name) || owners.includes(entry.owner) || all) return true
    if (files.has(registryPath) && (!registry.some(current => current.name === entry.name) || JSON.stringify(old.get(entry.name)) !== JSON.stringify(entry))) return true
    if ([entry.owner, entry.replacement && `apps/web-desktop/${entry.replacement}`, ...entry.tests.map(test => test.file)].some(file => files.has(file))) return true
    if (!changed.length) return false
    if (!dependencies.has(entry.owner)) dependencies.set(entry.owner, behaviorDependencies(entry.owner, root))
    if (entry.replacement?.startsWith('src/')) {
      const replacement = `apps/web-desktop/${entry.replacement}`
      if (!dependencies.has(replacement)) dependencies.set(replacement, behaviorDependencies(replacement, root))
      if (changed.some(file => dependencies.get(replacement).has(file))) return true
    }
    return changed.some(file => dependencies.get(entry.owner).has(file))
  })
}

const executor = file => file.startsWith('tests/browser/') && file.endsWith('.spec.mjs') ? 'browser'
  : file.endsWith('.mjs') && (file.startsWith('scripts/') || file.startsWith('apps/web-desktop/scripts/')) ? 'node' : 'upstream-reference'

export function behaviorPlan(entries, runner = 'all') {
  if (!['all', 'node', 'browser'].includes(runner)) throw new Error(`Unknown runner: ${runner}`)
  const references = [...new Map(entries.flatMap(entry => entry.tests).map(test => [JSON.stringify(test), { ...test, runner: executor(test.file) }])).values()]
  return { version: 1, status: 'planned', runner, entries: entries.map(entry => entry.name),
    requested: references.filter(test => runner === 'all' || test.runner === runner),
    deferred: references.filter(test => runner !== 'all' && test.runner !== runner) }
}

export function verifyObserved(references, observed) {
  return references.filter(reference => !observed.some(test => test.file === reference.file && test.status === 'passed' && test.name.includes(reference.scenario)))
}

export function browserObservations(report) {
  const observed = []
  const visit = suite => {
    for (const spec of suite.specs || []) for (const test of spec.tests || []) {
      const file = spec.file || suite.file
      observed.push({ file: report.config?.rootDir && file ? path.resolve(report.config.rootDir, file) : file, name: spec.title,
        status: test.expectedStatus === 'passed' && test.results?.at(-1)?.status === 'passed' ? 'passed' : 'failed',
        error: test.results?.at(-1)?.error?.message })
    }
    for (const child of suite.suites || []) visit(child)
  }
  for (const suite of report.suites || []) visit(suite)
  return observed
}

export function executeBehavior(plan, root = repositoryRoot) {
  root = realpathSync(root)
  const observed = [], failures = [], artifacts = []
  for (const runner of ['node', 'browser']) {
    const references = plan.requested.filter(test => test.runner === runner)
    if (!references.length) continue
    const files = [...new Set(references.map(test => test.file))]
    const pattern = [...new Set(references.map(test => escape(test.scenario)))].join('|')
    const output = runner === 'browser' ? mkdtempSync(path.join(tmpdir(), 'athena-behavior-browser-')) : null
    if (output) artifacts.push(output)
    for (const file of files) if (!existsSync(path.join(root, file))) throw new Error(`Missing requested test file: ${file}`)
    const args = runner === 'node'
      ? ['--test', '--test-reporter', path.join(root, 'scripts/behavior-reporter.mjs'), '--test-name-pattern', pattern, ...files]
      : [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test', ...files, '--project=chromium', '--reporter=json', '--output', output, '--grep', pattern]
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    if (result.error) throw result.error
    if (result.status !== 0) failures.push({ runner, status: result.status, detail: result.stderr.slice(-4000) })
    try {
      const results = runner === 'node' ? result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : browserObservations(JSON.parse(result.stdout))
      observed.push(...results.map(test => ({ ...test, file: path.isAbsolute(test.file || '') ? path.relative(root, test.file).replaceAll('\\', '/') : test.file })))
    } catch { failures.push({ runner, detail: 'The test runner did not produce valid execution evidence' }) }
  }
  const unsupported = plan.requested.filter(test => test.runner === 'upstream-reference')
  const missing = verifyObserved(plan.requested, observed)
  return { ...plan, status: failures.length || missing.length || !plan.requested.length ? 'failed' : 'passed', observed, missing, unsupported, failures, artifacts }
}

export function parseBehaviorArgs(args) {
  const options = { entries: [], owners: [], run: false, runner: 'all' }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--run') options.run = true
    else if (arg === '--list') options.run = false
    else if (['--entry', '--owner', '--changed', '--runner', '--output'].includes(arg)) {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
      if (arg === '--entry') options.entries.push(value)
      else if (arg === '--owner') options.owners.push(value)
      else options[arg.slice(2)] = value
    } else throw new Error(`Unknown option: ${arg}`)
  }
  if (!options.entries.length && !options.owners.length && !options.changed) throw new Error('Choose --entry NAME, --owner FILE or --changed REF; add --run to execute the declared scenarios')
  return options
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseBehaviorArgs(process.argv.slice(2))
    let changed = [], previous = []
    if (options.changed) {
      const commit = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${options.changed}^{commit}`], { cwd: repositoryRoot, encoding: 'utf8' }).trim()
      changed = execFileSync('git', ['diff', '--name-only', commit, '--'], { cwd: repositoryRoot, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
      previous = previousRegistry(commit)
    }
    const selected = selectBehavior(loadRegistry(), { ...options, changed, previous })
    if (!selected.length && options.run) throw new Error('No compatibility entries matched; no behavioral verification was performed')
    const plan = behaviorPlan(selected, options.runner)
    const report = options.run ? executeBehavior(plan) : plan
    const json = JSON.stringify(report, null, 2) + '\n'
    if (options.output) { mkdirSync(path.dirname(options.output), { recursive: true }); writeFileSync(options.output, json) }
    process.stdout.write(json)
    if (report.status === 'failed') process.exitCode = 1
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
