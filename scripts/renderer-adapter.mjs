import { createRequire } from 'node:module'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { repositoryRoot } from './renderer.mjs'
import { rendererAliases, compatibilityAliases } from './aliases.mjs'
import { loadRegistry, checkGeneratedRegistryFiles, verifyInstalledInputs } from './compatibility-registry.mjs'

// Evaluate only wrapper-owned build adapters. Renderer modules are never run
// to construct this graph, and their fetched source directories stay untouched.
function transformerLoader() {
  const cache = new Map()
  const load = file => {
    if (cache.has(file)) return cache.get(file)
    const exports = {}, module = { exports }
    cache.set(file, exports)
    const require = createRequire(file)
    const context = vm.createContext({ exports, module, console, process, Buffer, URL,
      __filename: file, __dirname: path.dirname(file), require: specifier => {
        if (specifier.startsWith('.')) {
          const target = path.resolve(path.dirname(file), specifier)
          if (target.endsWith('.ts')) return load(target)
          if (!path.extname(target) && existsSync(target + '.ts')) return load(target + '.ts')
          if (target.endsWith('.json')) return JSON.parse(readFileSync(target, 'utf8'))
        }
        return require(specifier)
      }
    })
    const source = ts.transpileModule(readFileSync(file, 'utf8'), {
      fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText
    vm.runInContext(source, context, { filename: file })
    return module.exports
  }
  return { load, files: () => [...cache.keys()] }
}

export function adapterAliases(root, env = process.env) {
  const compatibility = compatibilityAliases(root, env)
  return [
    { find: '../../../node_modules/@nous-research/ui/dist/fonts/Collapse-Bold.woff2', replacement: path.join(root, 'src/assets/fonts/Collapse-Bold.woff2') },
    ...compatibility.filter(alias => alias.find === '@/debug/dev-only'),
    ...rendererAliases(root),
    ...compatibility.filter(alias => alias.find !== '@/debug/dev-only')
  ]
}

/** One ordered source graph and replacement policy for TypeScript and Vite. */
export function createRendererAdapter(root = path.join(repositoryRoot, 'apps/web-desktop')) {
  const registry = loadRegistry(path.resolve(root, '../..'))
  checkGeneratedRegistryFiles(registry, path.resolve(root, '../..'))
  verifyInstalledInputs(registry, path.resolve(root, '../..'))
  const loader = transformerLoader()
  const definitions = ['dependency-compatibility.ts', 'athena-branding.ts', 'browser-plugin.ts', 'transforms.ts']
    .map(file => path.join(root, 'src/upstream', file))
  const [dependency, branding, browser, renderer] = definitions.map(loader.load)
  const stages = [
    dependency.dependencyCompatibilityPlugin(root), branding.athenaBranding(),
    browser.browserPlugin(root), renderer.rendererCompatibilityPlugin(path.resolve(root, '../desktop/src')),
    browser.browserActivityNotificationsPlugin(root)
  ]
  const aliases = adapterAliases(root)
  const roots = ['desktop', 'shared'].map(name => ({
    actual: realpathSync(path.resolve(root, '..', name)), logical: path.resolve(root, '..', name)
  }))
  const logicalId = file => {
    const normalized = file.replaceAll('\\', '/').split('?')[0]
    const alias = roots.find(root => normalized.startsWith(root.actual + '/'))
    return alias ? alias.logical + normalized.slice(alias.actual.length) : normalized
  }
  const virtual = specifier => {
    const entry = registry.find(entry => entry.kind === 'virtual-module' && entry.specifier === specifier)
    return entry ? path.resolve(root, '../desktop/src', entry.module) : null
  }
  const replacement = (id, importer) => {
    const resolved = logicalId(id), owner = importer ? logicalId(importer) : ''
    const entry = registry.filter(entry => entry.kind === 'replacement').sort((a, b) => a.order - b.order).find(entry =>
      resolved.endsWith('/desktop/src/' + entry.module) &&
      (!entry.importers || entry.importers.some(module => owner.endsWith('/desktop/src/' + module))) &&
      !entry.bypassImporters?.some(suffix => owner.endsWith(suffix)))
    if (entry) return path.resolve(root, entry.replacement)
    return id
  }
  const alias = specifier => {
    for (const entry of aliases) {
      if (typeof entry.find === 'string' && entry.find === specifier) return entry.replacement
      if (entry.find instanceof RegExp && entry.find.test(specifier)) return specifier.replace(entry.find, entry.replacement)
    }
    return specifier
  }
  const transform = (source, file) => {
    const id = logicalId(file)
    let code = source
    for (const stage of stages) {
      const result = stage.transform?.(code, id)
      if (result) {
        const output = typeof result === 'string' ? result : result.code
        if (typeof output !== 'string') throw new Error(`Adapter stage must produce synchronous source: ${stage.name}`)
        code = output
      }
    }
    return code
  }
  return { root, registry, definitions: loader.files(), stages, aliases, logicalId, virtual, replacement, alias, transform }
}

export function rendererAdapterPlugin(root) {
  const adapter = createRendererAdapter(root)
  return {
    name: 'athena:renderer-adapter', enforce: 'pre',
    config: () => adapter.stages[0].config(),
    buildStart() {
      const repository = path.resolve(root, '../..')
      checkGeneratedRegistryFiles(adapter.registry, repository)
      verifyInstalledInputs(adapter.registry, repository)
      for (const stage of adapter.stages) stage.buildStart?.call(this)
    },
    async resolveId(source, importer) {
      const virtual = adapter.virtual(source)
      if (virtual) return virtual
      const resolved = await this.resolve(source, importer, { skipSelf: true })
      if (!resolved) return null
      const replacement = adapter.replacement(resolved.id, importer)
      return replacement === resolved.id ? null : replacement
    },
    transform(code, id) {
      const output = adapter.transform(code, id)
      return output === code ? null : { code: output, map: null }
    },
    configureServer(server) {
      const watched = [...adapter.definitions, path.join(root, 'src/upstream/compatibility-registry.json')]
      server.watcher.add(watched)
      server.watcher.on('change', file => { if (watched.includes(file)) void server.restart() })
    }
  }
}
