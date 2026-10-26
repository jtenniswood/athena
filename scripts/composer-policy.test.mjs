import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'
import { browserPreferences, createBrowserPreference } from './browser-preference-contract.mjs'

const root = path.resolve('apps/web-desktop')
const pluginFile = path.join(root, 'src/upstream/browser-plugin.ts')
const plugin = vm.createContext({ exports: {}, require: createRequire(pluginFile) })
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
vm.runInContext(compile(readFileSync(pluginFile, 'utf8')), plugin)
const original = readFileSync(path.join(root, '../desktop/src/app/chat/composer/hooks/use-composer-submit.ts'), 'utf8')
const source = plugin.exports.useBrowserFollowupSubmit(plugin.exports.useBrowserAcceptedSubmit(original, root), root)

function composer({ preference = 'queue', busy = true, disabled = false, attachments = [], queueEdit = null, blocking = false, parked = false, yielded = false, text = 'live draft', backendMode = null, accepted = true } = {}) {
  const calls = []
  const preferenceStore = createBrowserPreference(browserPreferences.followupBehavior, {
    storage: () => ({ getItem: () => preference }), persist() {}, events: new EventTarget()
  })
  const policy = vm.createContext({ exports: {}, require: () => ({ browserPreference: () => preferenceStore }) })
  vm.runInContext(compile(readFileSync(path.join(root, 'src/experience/followup-preferences.ts'), 'utf8')), policy)
  const realm = vm.createContext({ exports: {}, crypto, require: name => {
    if (name.endsWith('/followup-preferences')) return policy.exports
    if (name.endsWith('/accepted-submit')) return { announceBrowserAcceptedSubmit: () => calls.push('accepted') }
    if (name === 'react') return { useRef: current => ({ current }), useLayoutEffect() {} }
    if (name === '@/i18n') return { useI18n: () => ({ t: { desktop: {} } }), translateNow: key => key }
    if (name.endsWith('/chat-runtime')) return { isSlashCommandText: text => /^\/\w/.test(text) }
    if (name.endsWith('/desktop-slash-commands')) return { isSideTaskSlashCommand: () => false }
    if (name.endsWith('/notifications')) return { notify() {} }
    if (name === '@hermes/shared') return { SLASH_COMMAND_RE: /^\/\w/ }
    if (name.endsWith('pane-visibility')) return { usePaneVisible: () => true }
    if (name.endsWith('/scope')) return { useComposerScope: () => ({ target: 'main', attachments: { clear() {} } }), useComposerSurfaceId: () => 'main' }
    if (name.endsWith('/rich-editor')) return { composerPlainText: editor => editor.textContent }
    if (name.endsWith('/path-refs')) return { pathifyRefs: value => value }
    if (name.endsWith('/haptics')) return { triggerHaptic() {} }
    if (name.endsWith('/clarify')) return { hasClarifyRequest: () => false }
    if (name.endsWith('/parked-card-answers')) return {
      answerParkedCard: () => { if (parked) calls.push('answer-card'); return parked },
      yieldParkedCardsToMessage: () => yielded, skipParkedCards() {}
    }
    if (name.endsWith('/connection-request')) return { hasConnectionRequest: () => false }
    if (name.endsWith('/prompts')) return { hasBlockingPromptRequest: () => blocking }
    if (name.endsWith('/composer-utils')) return { cloneAttachments: value => value }
    if (name.endsWith('/composer-input-history')) return { resetBrowseState() {} }
    if (name.endsWith('/composer')) return { clearSessionDraft() {}, isFreshDraftScope: scope => scope?.startsWith('__new__:'), freezeComposerTransportPayload: text => ({ displayText: text, transportText: text, missingLabels: [] }) }
    if (name.endsWith('/composer-draft-retry')) return { draftRetry: (id, text, attachments) => ({ id, text, attachments }) }
    if (name.endsWith('/composer-queue')) return { enqueueQueuedPrompt: () => calls.push('fallback-queue'), serverOwnsComposerQueue: () => false }
    if (name.endsWith('/focus')) return { onComposerSubmitRequest() {} }
    throw new Error(`Unexpected composer import: ${name}`)
  } })
  vm.runInContext(compile(source), realm)
  const draftRef = { current: 'stale draft' }
  const submit = realm.exports.useComposerSubmit({
    activeQueueSessionKey: 'session', activeQueueSessionKeyRef: { current: 'session' },
    attachments, busy, busyInputMode: backendMode, disabled, queueEdit, queuedPrompts: [], sessionId: 'session',
    draftScopeRef: { current: 'session' }, draftRef, editorRef: { current: { textContent: text } },
    clearDraft: () => calls.push('clear'), focusInput: () => calls.push('focus'),
    queueCurrentDraft: () => { calls.push('queue'); return true },
    exitQueuedEdit: () => { calls.push('save-edit'); return true },
    setComposerText: value => { draftRef.current = value },
    onSubmit: value => { calls.push(`send:${value}`); return accepted },
    onSteer: (value, mode) => { calls.push(`steer:${value}`); calls.push(`mode:${mode}`); return true },
    onCancel: () => calls.push('stop'), loadIntoComposer: value => calls.push(`restore:${value}`), stashAt() {},
    rememberDraftRetry: (_scope, retry) => calls.push(`retry:${retry.text}`)
  })
  return { submit, calls, draftRef }
}

test('composer policy chooses queue or steer regardless of backend policy and alternate reverses it', async () => {
  for (const backendMode of [null, 'queue', 'interrupt', 'steer']) for (const preference of ['queue', 'steer']) for (const alternate of [false, true]) {
    const { submit, calls, draftRef } = composer({ preference, backendMode })
    submit.submitDraft(alternate)
    await new Promise(resolve => setImmediate(resolve))
    const queue = preference === 'queue' ? !alternate : alternate
    assert.equal(calls.includes('queue'), queue)
    assert.equal(calls.includes('steer:live draft'), !queue)
    assert.equal(calls.includes('mode:interrupt'), !queue)
    assert.equal(draftRef.current, 'live draft')
  }
})

test('busy slash commands bypass follow-up queuing and rejected sends retain their retry identity', async () => {
  const slash = composer({ preference: 'queue', text: '/status' })
  slash.submit.submitDraft()
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(slash.calls.includes('send:/status'))
  assert.ok(!slash.calls.includes('queue'))
  const rejected = composer({ busy: false, accepted: false })
  rejected.submit.submitDraft()
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(rejected.calls.includes('restore:live draft'))
  assert.ok(rejected.calls.includes('retry:live draft'))
})

test('browser policy keeps idle sends, queue edits, disabled controls and blocking fallbacks in the engine', () => {
  const idle = composer({ busy: false }); idle.submit.submitDraft(); assert.ok(idle.calls.includes('send:live draft'))
  const editing = composer({ queueEdit: {} }); editing.submit.submitDraft(); assert.ok(editing.calls.includes('save-edit')); assert.ok(!editing.calls.includes('queue'))
  const disabled = composer({ disabled: true }); disabled.submit.submitDraft(); assert.deepEqual(disabled.calls, [])
  for (const options of [{ attachments: [{}] }, { blocking: true }]) {
    const entry = composer({ preference: 'steer', ...options }); entry.submit.submitDraft(); assert.ok(entry.calls.includes('queue')); assert.ok(!entry.calls.includes('steer:live draft'))
  }
})

test('a waiting card consumes typed answers before either browser follow-up preference', () => {
  for (const preference of ['queue', 'steer']) for (const alternate of [false, true]) {
    const entry = composer({ preference, parked: true })
    entry.submit.submitDraft(alternate)
    assert.deepEqual(entry.calls, ['answer-card', 'clear', 'focus'])
  }
  const entry = composer({ preference: 'steer', yielded: true })
  entry.submit.submitDraft()
  assert.ok(entry.calls.includes('queue'))
  assert.ok(!entry.calls.includes('steer:live draft'))
})
