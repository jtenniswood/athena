import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRendererAdapter } from './renderer-adapter.mjs'
import { registryPath, sourceRoots } from './compatibility-registry.mjs'
import { rendererLock, repositoryRoot, verifyRenderer } from './renderer.mjs'

const hash = source => createHash('sha256').update(source).digest('hex')
const inspectable = entry => entry.module && ['renderer', 'shared'].includes(entry.sourceRoot)

/** Export the shared adapter's source output, keeping resolution policies explicit. */
export function inspectRenderer({ entries = [], root = repositoryRoot } = {}) {
  verifyRenderer(root)
  const webRoot = path.join(root, 'apps/web-desktop')
  const adapter = createRendererAdapter(webRoot)
  for (const name of entries) {
    if (!adapter.registry.some(entry => entry.name === name && inspectable(entry))) throw new Error(`No inspectable renderer module for entry: ${name}`)
  }
  const selected = adapter.registry.filter(entry => inspectable(entry) && (!entries.length || entries.includes(entry.name)))
  const targets = [...new Set(selected.map(entry => `${entry.sourceRoot}/${entry.module}`))].sort()
  const files = {}, modules = []
  for (const target of targets) {
    const [sourceRoot, ...parts] = target.split('/'), module = parts.join('/')
    const file = path.join(root, sourceRoots[sourceRoot], module)
    const input = readFileSync(file, 'utf8'), adapted = adapter.transform(input, file)
    const related = adapter.registry.filter(entry => entry.sourceRoot === sourceRoot && entry.module === module)
    const originalFile = `original/${target}`, adaptedFile = `adapted/${target}`
    files[originalFile] = input
    files[adaptedFile] = adapted
    const replacements = related.filter(entry => entry.kind === 'replacement').map(entry => {
      const artifact = `replacements/${entry.replacement}`
      files[artifact] = readFileSync(path.join(webRoot, entry.replacement), 'utf8')
      return { entry: entry.name, source: `apps/web-desktop/${entry.replacement}`, artifact,
        importers: entry.importers ?? null, bypassImporters: entry.bypassImporters ?? [], sha256: hash(files[artifact]) }
    })
    modules.push({ sourceRoot, module, entries: related.map(entry => entry.name), originalFile, adaptedFile,
      originalHash: hash(input), adaptedHash: hash(adapted),
      normalizedAdaptedHash: hash(adapted.replaceAll(webRoot, '<web-root>')), replacements,
      transforms: related.filter(entry => entry.kind.endsWith('transform')).sort((a, b) => a.order - b.order)
        .map(entry => ({ entry: entry.name, owner: entry.owner, order: entry.order, inputHash: entry.inputHash ?? entry.sourceHash, outputHash: entry.outputHash })) })
  }
  return { manifest: {
    version: 1,
    purpose: 'Diagnostic source snapshots. Adapted files are the shared transform output before module replacement resolution; this is not a standalone build or behavioral verification.',
    hashNormalization: 'normalizedAdaptedHash replaces the absolute web application root with <web-root>; artifact hashes cover exact emitted bytes.',
    wrapperRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    rendererRevision: rendererLock(root).rev,
    dependencyLockHash: hash(readFileSync(path.join(root, 'pnpm-lock.yaml'))),
    registryHash: hash(readFileSync(path.join(root, registryPath))),
    adapters: [...new Set([path.join(root, 'scripts/renderer-adapter.mjs'), path.join(root, 'scripts/aliases.mjs'), ...adapter.definitions])]
      .sort().map(file => ({ file: path.relative(root, file).replaceAll('\\', '/'), sha256: hash(readFileSync(file)) })),
    modules
  }, files }
}

/** A new directory prevents stale snapshots and never overwrites source or prior evidence. */
export function writeRendererInspection(inspection, output) {
  mkdirSync(output)
  for (const [file, content] of Object.entries(inspection.files)) {
    const target = path.join(output, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content, { flag: 'wx' })
  }
  writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(inspection.manifest, null, 2) + '\n', { flag: 'wx' })
}

export function inspectionArguments(args) {
  const options = { entries: [], output: null }
  for (let index = 0; index < args.length; index++) {
    const flag = args[index], value = args[++index]
    if (!['--entry', '--output'].includes(flag) || !value || value.startsWith('--')) throw new Error('Usage: inspect-renderer.mjs [--entry NAME ...] [--output NEW_DIRECTORY]')
    if (flag === '--entry') options.entries.push(value)
    else if (options.output) throw new Error('Specify --output only once')
    else options.output = value
  }
  return options
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { entries, output: requested } = inspectionArguments(process.argv.slice(2))
    const inspection = inspectRenderer({ entries })
    let output
    if (requested) {
      output = path.resolve(requested)
      const parent = realpathSync(path.dirname(output))
      for (const name of ['desktop', 'shared']) {
        const source = realpathSync(path.join(repositoryRoot, 'apps', name))
        const renderer = realpathSync(execFileSync('git', ['-C', source, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim())
        if (parent === renderer || parent.startsWith(renderer + path.sep)) throw new Error('Inspection output must stay outside fetched renderer sources')
      }
      if (existsSync(output)) throw new Error('Inspection output must be a new directory')
    } else {
      const base = path.join(repositoryRoot, 'test-results/renderer-inspection')
      mkdirSync(base, { recursive: true })
      output = mkdtempSync(path.join(base, 'snapshot-'))
      // The writer requires a new directory; use a child of the reserved path.
      output = path.join(output, 'sources')
    }
    writeRendererInspection(inspection, output)
    console.log(`Inspected ${inspection.manifest.modules.length} renderer modules: ${output}`)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
