import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

const root = path.resolve('apps/web-desktop')
const pluginFile = path.join(root, 'src/upstream/browser-plugin.ts')
const plugin = vm.createContext({ exports: {}, require: createRequire(pluginFile) })
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
vm.runInContext(compile(readFileSync(pluginFile, 'utf8')), plugin)
const original = readFileSync(path.join(root, '../desktop/src/app/chat/composer/hooks/use-composer-submit.ts'), 'utf8')
const source = plugin.exports.useBrowserFollowupSubmit(plugin.exports.useBrowserAcceptedSubmit(original, root), root)

function composer({ preference = 'queue', busy = true, disabled = false, attachments = [], queueEdit = null, blocking = false, compacting = false, text = 'live draft' } = {}) {
  const calls = []
  const policy = vm.createContext({ exports: {}, window: { localStorage: { getItem: () => preference } }, require: () => ({}) })
  vm.runInContext(compile(readFileSync(path.join(root, 'src/experience/followup-preferences.ts'), 'utf8')), policy)
  const realm = vm.createContext({ exports: {}, require: name => {
    if (name.endsWith('/followup-preferences')) return policy.exports
    if (name.endsWith('/accepted-submit')) return { announceBrowserAcceptedSubmit: () => calls.push('accepted') }
    if (name === 'react') return { useRef: current => ({ current }), useLayoutEffect() {} }
    if (name === '@hermes/shared') return { SLASH_COMMAND_RE: /^\/\w/ }
    if (name.endsWith('pane-visibility')) return { usePaneVisible: () => true }
    if (name.endsWith('/scope')) return { useComposerScope: () => ({ target: 'main', attachments: { clear() {} } }), useComposerSurfaceId: () => 'main' }
    if (name.endsWith('/rich-editor')) return { composerPlainText: editor => editor.textContent }
    if (name.endsWith('/path-refs')) return { pathifyRefs: value => value }
    if (name.endsWith('/haptics')) return { triggerHaptic() {} }
    if (name.endsWith('/clarify')) return { hasClarifyRequest: () => false }
    if (name.endsWith('/connection-request')) return { hasConnectionRequest: () => false }
    if (name.endsWith('/prompts')) return { hasBlockingPromptRequest: () => blocking }
    if (name.endsWith('/composer-utils')) return { cloneAttachments: value => value }
    if (name.endsWith('/composer-input-history')) return { resetBrowseState() {} }
    if (name.endsWith('/composer')) return { clearSessionDraft() {} }
    if (name.endsWith('/composer-queue')) return { enqueueQueuedPrompt: () => calls.push('fallback-queue') }
    if (name.endsWith('/focus')) return { onComposerSubmitRequest() {} }
    throw new Error(`Unexpected composer import: ${name}`)
  } })
  vm.runInContext(compile(source), realm)
  const draftRef = { current: 'stale draft' }
  const submit = realm.exports.useComposerSubmit({
    activeQueueSessionKey: 'session', activeQueueSessionKeyRef: { current: 'session' },
    attachments, busy, compacting, disabled, queueEdit, queuedPrompts: [], sessionId: 'session',
    draftRef, editorRef: { current: { textContent: text } },
    clearDraft: () => calls.push('clear'), focusInput: () => calls.push('focus'),
    queueCurrentDraft: () => { calls.push('queue'); return true },
    exitQueuedEdit: () => { calls.push('save-edit'); return true },
    setComposerText: value => { draftRef.current = value },
    onSubmit: value => { calls.push(`send:${value}`); return true },
    onSteer: value => { calls.push(`steer:${value}`); return true },
    onCancel: () => calls.push('stop'), loadIntoComposer() {}, stashAt() {}
  })
  return { submit, calls, draftRef }
}

test('composer policy chooses queue or steer and an alternate intent reverses the preference', () => {
  for (const preference of ['queue', 'steer']) for (const alternate of [false, true]) {
    const { submit, calls, draftRef } = composer({ preference })
    submit.submitDraft(alternate)
    const queue = preference === 'queue' ? !alternate : alternate
    assert.equal(calls.includes('queue'), queue)
    assert.equal(calls.includes('steer:live draft'), !queue)
    assert.equal(draftRef.current, 'live draft')
  }
})

test('browser policy keeps idle sends, queue edits, disabled controls and blocking fallbacks in the engine', () => {
  const idle = composer({ busy: false }); idle.submit.submitDraft(); assert.ok(idle.calls.includes('send:live draft'))
  const editing = composer({ queueEdit: {} }); editing.submit.submitDraft(); assert.ok(editing.calls.includes('save-edit')); assert.ok(!editing.calls.includes('queue'))
  const disabled = composer({ disabled: true }); disabled.submit.submitDraft(); assert.deepEqual(disabled.calls, [])
  for (const options of [{ attachments: [{}] }, { blocking: true }, { compacting: true }]) {
    const entry = composer({ preference: 'steer', ...options }); entry.submit.submitDraft(); assert.ok(entry.calls.includes('queue')); assert.ok(!entry.calls.includes('steer:live draft'))
  }
})
