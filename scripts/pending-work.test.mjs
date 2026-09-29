import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../apps/web-desktop/src/platform/pending-work.ts', import.meta.url), 'utf8')
function loadRegistry() {
  const context = vm.createContext({ exports: {} })
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, context)
  return context.exports
}

test('pending work waits for each owner before reporting readiness', async () => {
  const { flushPendingBrowserWork, registerPendingBrowserWork } = loadRegistry()
  const completed = []
  const releaseSettings = registerPendingBrowserWork({ id: 'settings', prepare: async () => { completed.push('settings'); return { ready: true } } })
  const releaseComposer = registerPendingBrowserWork({ id: 'composer', prepare: async () => { completed.push('composer'); return { ready: true } } })

  assert.equal((await flushPendingBrowserWork()).ready, true)
  assert.deepEqual(completed, ['settings', 'composer'])
  releaseSettings()
  releaseComposer()
})

test('a replaced owner cannot be removed by an older cleanup', async () => {
  const { flushPendingBrowserWork, registerPendingBrowserWork } = loadRegistry()
  const releaseOld = registerPendingBrowserWork({ id: 'replacement', prepare: async () => ({ ready: false, reason: 'stale' }) })
  let prepared = 0
  const releaseCurrent = registerPendingBrowserWork({ id: 'replacement', prepare: async () => { prepared++; return { ready: true } } })
  releaseOld()

  assert.equal((await flushPendingBrowserWork()).ready, true)
  assert.equal(prepared, 1)
  releaseCurrent()
  assert.equal((await flushPendingBrowserWork()).ready, true)
})

test('a failed owner blocks readiness with its recovery reason', async () => {
  const { flushPendingBrowserWork, registerPendingBrowserWork } = loadRegistry()
  const release = registerPendingBrowserWork({ id: 'failed-settings', prepare: async () => ({ ready: false, reason: 'Save the setting again.' }) })
  const result = await flushPendingBrowserWork()
  assert.equal(result.ready, false)
  assert.equal(result.reason, 'Save the setting again.')
  release()
})

test('work registered during preparation is included before readiness', async () => {
  const { flushPendingBrowserWork, registerPendingBrowserWork } = loadRegistry()
  const prepared = []
  let addedComposer = false
  let releaseSettings
  let releaseComposer
  releaseSettings = registerPendingBrowserWork({
    id: 'late-settings',
    async prepare() {
      prepared.push('settings')
      if (!addedComposer) {
        addedComposer = true
        releaseComposer = registerPendingBrowserWork({ id: 'late-composer', prepare: async () => { prepared.push('composer'); return { ready: true } } })
      }
      return { ready: true }
    }
  })

  assert.equal((await flushPendingBrowserWork()).ready, true)
  assert.deepEqual(prepared, ['settings', 'settings', 'composer'])
  releaseSettings()
  releaseComposer()
})
