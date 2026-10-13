import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { Plugin } from 'vite'
import registry from './compatibility-registry.json'

// nanostores 1.4.0 marks batch() side-effect-free even though it executes its
// callback. Rolldown consequently deletes upstream batch(() => store.set(...))
// calls whose return value is unused. Remove only that erroneous annotation;
// preserve batching, queue semantics, and all other tree-shaking hints.
const sourceHash = registry.find(entry => entry.name === 'nanostores-batch-effects')!.sourceHash
const before = '/* @__NO_SIDE_EFFECTS__ */\nexport const batch = fn => {'
const after = '/* Hermes Web: batch executes its callback and must be retained. */\nexport const batch = fn => {'
export function preserveBatchEffects(code: string): string {
  const original = code.replace(after, before)
  if (createHash('sha256').update(original).digest('hex') !== sourceHash || original.split(before).length !== 2) {
    throw new Error('nanostores batch compatibility changed; review the locked dependency before building')
  }
  return original.replace(before, after)
}

// core 0.2.23 subscribes around its lazy thread-list snapshot cache, leaving
// every getState() read uncached. Connect subscribers to the cache and keep
// reads stable even before the first subscription (and after cleanup).
const threadListHash = registry.find(entry => entry.name === 'assistant-ui-thread-list-snapshots')!.sourceHash
const threadListRewrites = [
  ['const stateBinding = new LazyMemoizeSubject({', 'const stateBinding = new ShallowMemoizeSubject({'],
  ['this._getState = stateBinding.getState.bind(stateBinding);', 'this._getState = stateBinding.getState.bind(stateBinding);\n\t\tthis._subscribe = stateBinding.subscribe.bind(stateBinding);'],
  ['return this._core.subscribe(callback);', 'return this._subscribe(callback);']
] as const

export function cacheThreadListSnapshots(code: string): string {
  let original = code
  for (const [before, after] of threadListRewrites) original = original.replace(after, before)
  if (createHash('sha256').update(original).digest('hex') !== threadListHash || threadListRewrites.some(([before]) => original.split(before).length !== 2)) {
    throw new Error('assistant-ui thread-list compatibility changed; review the locked dependency before building')
  }
  for (const [before, after] of threadListRewrites) original = original.replace(before, after)
  return original
}

export function dependencyCompatibilityPlugin(root: string): Plugin {
  const require = createRequire(path.join(root, 'package.json'))
  const target = path.join(path.dirname(require.resolve('nanostores')), 'atom/index.js')
  const threadListTarget = path.join(path.dirname(require.resolve('@assistant-ui/core/internal')), 'runtime/api/thread-list-runtime.js')
  const transform = (code: string, id: string) => {
    const normalized = id.replaceAll('\\', '/').split('?')[0]
    if (normalized.endsWith('/nanostores/atom/index.js')) return { code: preserveBatchEffects(code), map: null }
    if (normalized.endsWith('/@assistant-ui/core/dist/runtime/api/thread-list-runtime.js')) return { code: cacheThreadListSnapshots(code), map: null }
    return null
  }
  return {
    name: 'hermes:dependency-compatibility', enforce: 'pre',
    // Apply the same fixes when Vite prebundles dependencies in development.
    config() {
      return { optimizeDeps: { rolldownOptions: { plugins: [{
        name: 'hermes:dependency-compatibility-prebundle',
        transform
      }] } } }
    },
    buildStart() {
      preserveBatchEffects(readFileSync(target, 'utf8'))
      cacheThreadListSnapshots(readFileSync(threadListTarget, 'utf8'))
    },
    transform
  }
}
