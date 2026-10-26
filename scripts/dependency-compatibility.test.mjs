import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { build } from 'vite'
const root = path.resolve('apps/web-desktop')
const require = createRequire(import.meta.url)

test('thread-list snapshots stay cached across subscriptions and real updates', async () => {
  async function bundle() {
    const result = await build({ configFile: false, root, logLevel: 'silent', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, plugins: [
      { name: 'snapshot-regression', resolveId(id) { if (id === 'snapshot-regression' || id.endsWith('/snapshot-regression')) return '\0snapshot-regression' }, load(id) { if (id === '\0snapshot-regression') return `
        import { AssistantRuntimeImpl, ExternalStoreRuntimeCore } from ${JSON.stringify(require.resolve('@assistant-ui/core/internal'))};
        const core = new ExternalStoreRuntimeCore({ messages: [], onNew: async () => {} });
        const threads = new AssistantRuntimeImpl(core).threads;
        const before = threads.getState();
        const stableBefore = before === threads.getState();
        const notifications = [];
        const stop = threads.subscribe(() => notifications.push(threads.getState()));
        const stableSubscribed = threads.getState() === threads.getState();
        const adapter = { threadId: 'other', threads: [{ id: 'other', title: 'Other chat' }] };
        core.threads.__internal_setAdapter(adapter);
        const updated = threads.getState();
        const fresh = updated !== before && updated.mainThreadId === 'other' && updated.threadItems.other.title === 'Other chat';
        const notificationCurrent = notifications.length === 1 && notifications[0] === updated;
        core.threads.__internal_setAdapter(adapter);
        const stableNoop = updated === threads.getState() && notifications.length === 1;
        stop();
        const stableAfter = updated === threads.getState() && threads.getState() === threads.getState();
        core.threads.__internal_setAdapter({ ...adapter, threads: [{ id: 'other', title: 'Renamed chat' }] });
        const renamed = threads.getState();
        const freshAfterCleanup = renamed !== updated && renamed.threadItems.other.title === 'Renamed chat' && renamed === threads.getState() && notifications.length === 1;
        globalThis.result = { stableBefore, stableSubscribed, fresh, notificationCurrent, stableNoop, stableAfter, freshAfterCleanup };
      ` } }
    ], build: { write: false, minify: true, lib: { entry: 'snapshot-regression', formats: ['es'] } } })
    const output = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code
    const runtime = vm.createContext({ TransformStream, ReadableStream, TextEncoder, TextDecoder, AbortController }); vm.runInContext(output, runtime)
    return JSON.parse(JSON.stringify(runtime.result))
  }
  const state = await bundle()
  assert.ok(Object.values(state).every(Boolean), JSON.stringify(state))
})

test('production bundling preserves state writes inside batch callbacks', async () => {
  async function bundle() {
    const result = await build({ configFile: false, root, logLevel: 'silent', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, plugins: [
      { name: 'batch-regression', resolveId(id) { if (id === 'batch-regression' || id.endsWith('/batch-regression')) return '\0batch-regression' }, load(id) { if (id === '\0batch-regression') return `import { atom, batch } from ${JSON.stringify(require.resolve('nanostores'))}; const profiles = atom([]); batch(() => profiles.set(['default', 'research'])); globalThis.result = profiles.get();` } }
    ], build: { write: false, minify: true, lib: { entry: 'batch-regression', formats: ['es'] } } })
    const output = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code
    const runtime = vm.createContext({}); vm.runInContext(output, runtime)
    return Array.from(runtime.result)
  }
  assert.deepEqual(await bundle(), ['default', 'research'])
})

test('readonly plugin decisions support equality and computed subscriptions without exposing writes', async () => {
  const { readFileSync } = await import('node:fs')
  const { default: ts } = await import('typescript')
  const { atom, computed } = await import('nanostores')
  const file = path.join(root, 'src/upstream/transforms.ts')
  const context = vm.createContext({ exports: {}, require: createRequire(file) })
  vm.runInContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, context)
  const sourceFile = path.resolve('apps/desktop/src/sdk/bridge.ts')
  const output = context.exports.transformRenderer(readFileSync(sourceFile, 'utf8'), sourceFile).code
  const tree = ts.createSourceFile(sourceFile, output, ts.ScriptTarget.Latest, true)
  const declaration = tree.statements.flatMap(statement => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []).find(item => item.name.getText() === 'pluginDecisions')
  const decisions = atom({ demo: true })
  const sandbox = vm.createContext({ $pluginDecisions: decisions, frozen: value => Object.freeze({ ...value }) })
  vm.runInContext(`globalThis.view = ${declaration.initializer.getText()}`, sandbox)
  const view = sandbox.view
  assert.equal('set' in view, false)
  assert.ok(Object.isFrozen(view.get()))
  assert.ok(Object.isFrozen(view.value))
  assert.equal(view.eq(true, true), true)
  assert.equal(view.eq(true, false), false)
  const enabled = computed(view, value => value.demo)
  const observed = []
  const stop = enabled.subscribe(value => observed.push(value))
  decisions.set({ demo: false })
  stop()
  assert.deepEqual(observed, [true, false])
  assert.equal(enabled.get(), false)
})
