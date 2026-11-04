import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function load(name, globals = {}) {
  const source = readFileSync(new URL(`../apps/web-desktop/src/platform/${name}.ts`, import.meta.url), 'utf8')
  const context = vm.createContext({ exports: {}, require: specifier => specifier === './draft-safety'
    ? globals.draftSafety
    : specifier === './pending-work' ? { flushPendingBrowserWork: async () => ({ ready: true }) } : ({}), ...globals })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context)
  return context.exports
}
const { createConnectionState } = load('connection-state')
const origin = 'https://gateway.test'
function storage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
}
const legacy = (gateways, activeId = 'a') => ({ 'hermes-ui.gateways': JSON.stringify({ activeId, gateways }), 'hermes-web.session-token': 'global-old-token' })
const state = (store, id = 'configured') => createConnectionState(store, id, url => url === origin)

test('migrates the matching active credential without deleting other records', () => {
  const store = storage(legacy([{ id: 'a', url: origin, authMode: 'token', token: 'scoped' }, { id: 'b', url: 'https://other.test', token: 'other' }]))
  assert.equal(state(store).load().token, 'scoped')
  assert.equal(JSON.parse(store.getItem('hermes-ui.gateways')).gateways.length, 2)
  assert.equal(store.getItem('hermes-web.session-token'), 'global-old-token')
  state(store).update({ token: 'new-scoped', authMode: 'token' })
  assert.equal(state(store).load().token, 'new-scoped')
  assert.equal(store.getItem('hermes-web.session-token'), 'global-old-token')
  state(store).update({ authMode: 'oauth', token: '' })
  assert.equal(state(store).load().token, '')
})

test('global legacy tokens require one unambiguous matching connection', () => {
  const a = { id: 'a', url: origin, authMode: 'token' }
  assert.equal(state(storage(legacy([a]))).load().token, 'global-old-token')
  for (const connections of [[a, { id: 'b' }], [{ ...a, url: '' }], [{ ...a, url: 'https://different.test' }], [{ ...a, url: '/' }]]) {
    assert.equal(state(storage(legacy(connections))).load().token, '')
  }
  assert.equal(state(storage({ 'hermes-web.session-token': 'alone' })).load().token, '')
})

test('single legacy connection migrates; malformed records remain untouched', () => {
  const store = storage({ 'hermes-web.connection': JSON.stringify({ remoteUrl: origin, remoteAuthMode: 'token', remoteToken: 'single' }) })
  assert.equal(state(store).load().token, 'single')
  for (const value of ['{broken', 'null', '42', '[]']) {
    const invalid = storage({ 'hermes-ui.gateways': value })
    assert.equal(state(invalid).load().token, '')
    assert.equal(invalid.getItem('hermes-ui.gateways'), value)
  }
})

test('a changed backend identity cannot reuse a gateway-bound token', () => {
  const store = storage()
  state(store, 'first').update({ authMode: 'token', token: 'private-first' })
  assert.equal(state(store, 'second').load().token, '')
  assert.equal(state(store, 'first').load().token, 'private-first')
})

test('blocked, full, or unverifiable storage retains a usable in-memory session', () => {
  for (const store of [
    { getItem() { throw Error('blocked') }, setItem() { throw Error('blocked') } },
    { getItem: () => null, setItem() { throw Error('quota') } },
    { getItem: () => null, setItem() {} }
  ]) {
    const connection = state(store)
    connection.update({ authMode: 'token', token: 'memory-only' })
    assert.equal(connection.load().token, 'memory-only')
    assert.equal(connection.load().migration.complete, false)
    assert.equal(connection.persisted(), false)
  }
})

test('reload readiness flushes and verifies text and blocks turns, uploads, files and recordings', async () => {
  let draft = { storageKey: 'drafts', texts: { session: 'hello' }, attachments: 0, blocked: false }
  let persisted = JSON.stringify(draft.texts)
  const track = { readyState: 'live' }
  const navigator = { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } }
  let flush = async () => {}
  const draftSafety = { browserDraftSnapshot: () => draft, flushBrowserDrafts: () => flush() }
  const safety = load('reload-safety', { navigator, draftSafety, window: { localStorage: { getItem: () => persisted } } })
  assert.equal(safety.reloadReadiness().ready, false)
  safety.setActiveWork({ count: 0 }); assert.equal(safety.reloadReadiness().ready, true)
  safety.setActiveWork({ count: 1 }); assert.match(safety.reloadReadiness().reason, /response/)
  safety.setActiveWork({ count: 0 })
  const finish = safety.beginOperation(); assert.equal(safety.reloadReadiness().ready, false); finish(); finish()
  draft.attachments = 1; assert.match(safety.reloadReadiness().reason, /attachments/); draft.attachments = 0
  draft.blocked = true; assert.equal(safety.reloadReadiness().ready, false); draft.blocked = false
  persisted = '{}'; assert.match(safety.reloadReadiness().reason, /could not be saved/); persisted = JSON.stringify(draft.texts)
  flush = async () => { persisted = JSON.stringify(draft.texts) }
  await safety.assertSafeConnectionChange()
  persisted = '{}'
  flush = async () => {}
  await assert.rejects(safety.assertSafeConnectionChange(), /could not be saved/)
  persisted = JSON.stringify(draft.texts)
  safety.trackMediaRequests(); await navigator.mediaDevices.getUserMedia({ audio: true })
  assert.match(safety.reloadReadiness().reason, /recording/)
  track.readyState = 'ended'; assert.equal(safety.reloadReadiness().ready, true)
})

test('UI updates allow running turns but retain every browser work and draft guard', async () => {
  const draft = { storageKey: 'drafts', texts: { session: 'Keep this draft' }, attachments: 0, blocked: false }
  let persisted = JSON.stringify(draft.texts), flush = async () => {}
  const track = { readyState: 'live' }
  const navigator = { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } }
  const safety = load('reload-safety', { navigator,
    draftSafety: { browserDraftSnapshot: () => draft, flushBrowserDrafts: () => flush() },
    window: { localStorage: { getItem: () => persisted } }
  })
  const ready = () => safety.reloadReadinessAfterSaving('ui-update')
  assert.equal((await ready()).ready, false, 'an unconnected renderer is still unsafe')
  safety.setActiveWork({ count: 2 })
  assert.equal((await ready()).ready, true)
  await assert.rejects(safety.assertSafeConnectionChange(), /active response/)
  assert.throws(() => safety.assertSafeReload(), /active response/)
  const finish = safety.beginOperation()
  assert.match((await ready()).reason, /uploading/)
  finish()
  draft.attachments = 1; assert.match((await ready()).reason, /attachments/); draft.attachments = 0
  draft.blocked = true; assert.equal((await ready()).ready, false); draft.blocked = false
  persisted = '{}'; assert.match((await ready()).reason, /could not be saved/)
  flush = async () => { persisted = JSON.stringify(draft.texts) }
  assert.equal((await ready()).ready, true)
  safety.trackMediaRequests(); await navigator.mediaDevices.getUserMedia({ audio: true })
  assert.match((await ready()).reason, /recording/)
  track.readyState = 'ended'
  // Work can change while draft saves yield. The final check must still run.
  flush = async () => { draft.attachments = 1 }
  assert.match((await ready()).reason, /attachments/)
})

test('media leases keep separate voice and permission owners guarded until each finishes', async () => {
  let resolveStream, rejectPermission
  const navigator = { mediaDevices: { getUserMedia: () => new Promise((resolve, reject) => { resolveStream = resolve; rejectPermission = reject }) } }
  const safety = load('reload-safety', { navigator,
    draftSafety: { browserDraftSnapshot: () => ({ blocked: false, storageKey: 'drafts', texts: {}, attachments: 0 }) },
    window: { localStorage: { getItem: () => '{}' } }
  })
  safety.setActiveWork({ count: 0 })
  safety.trackMediaRequests()
  const firstVoice = safety.beginMediaOperation(), secondVoice = safety.beginMediaOperation()
  const permission = navigator.mediaDevices.getUserMedia({ audio: true })
  firstVoice(); firstVoice(); secondVoice()
  assert.match(safety.reloadReadiness().reason, /recording/)
  const track = { readyState: 'live' }
  resolveStream({ getTracks: () => [track] })
  await permission
  assert.match(safety.reloadReadiness().reason, /recording/)
  const transcript = safety.beginMediaOperation()
  track.readyState = 'ended'
  assert.match(safety.reloadReadiness().reason, /transcribing/)
  transcript(); transcript()
  assert.equal(safety.reloadReadiness().ready, true)
  const denied = navigator.mediaDevices.getUserMedia({ audio: true })
  rejectPermission(new Error('Permission denied'))
  await assert.rejects(denied, /Permission denied/)
  assert.equal(safety.reloadReadiness().ready, true)
})

function signOutFixture() {
  const root = { inert: false }, store = storage(), connection = state(store)
  connection.update({ authMode: 'token', token: 'synthetic-session-token' })
  const transitions = load('browser-transition', { document: { getElementById: () => root } })
  let prepare = async () => ({ ready: true }), logout = async () => ({ ok: true })
  let preparations = 0, logouts = 0, reloads = 0
  const { signOut } = load('sign-out', {
    require: specifier => ({
      './connection-state': { connectionState: () => connection },
      './browser-transition': transitions,
      './reload-safety': { reloadReadinessAfterSaving: () => { preparations++; return prepare() } }
    })[specifier],
    window: { location: { origin, reload: () => { reloads++ } }, hermesDesktop: {
      oauthLogoutConnectionConfig: () => { logouts++; return logout() }
    } }
  })
  return { root, store, connection, transitions, signOut,
    prepareWith(callback) { prepare = callback }, logoutWith(callback) { logout = callback },
    calls: () => ({ preparations, logouts, reloads }) }
}

test('sign-out reserves the transition before saving and retains it through logout and reload', async () => {
  const app = signOutFixture(), save = Promise.withResolvers(), logout = Promise.withResolvers(), entered = Promise.withResolvers()
  app.prepareWith(() => save.promise)
  app.logoutWith(() => { entered.resolve(); return logout.promise })
  const pending = app.signOut()
  assert.equal(app.root.inert, true)
  await app.signOut()
  assert.equal(app.transitions.beginBrowserTransition(), undefined)
  assert.deepEqual(app.calls(), { preparations: 1, logouts: 0, reloads: 0 })
  save.resolve({ ready: true })
  await entered.promise
  assert.equal(app.root.inert, true)
  assert.equal(app.transitions.beginBrowserTransition(), undefined)
  logout.resolve({ ok: true })
  await pending
  assert.deepEqual(app.calls(), { preparations: 2, logouts: 1, reloads: 1 })
  assert.equal(app.connection.load().token, '')
  assert.equal(app.root.inert, true, 'the outgoing document remains reserved until navigation')
})

test('sign-out yields to an existing transition without saving, logging out, or releasing its owner', async () => {
  const app = signOutFixture(), release = app.transitions.beginBrowserTransition()
  await app.signOut()
  assert.deepEqual(app.calls(), { preparations: 0, logouts: 0, reloads: 0 })
  assert.equal(app.connection.load().token, 'synthetic-session-token')
  assert.equal(app.root.inert, true)
  release()
  assert.equal(app.root.inert, false)
})

test('unsafe work and failed logout release sign-out without clearing saved credentials', async () => {
  for (const failure of ['unsafe', 'save-error', 'logout-error', 'logout-refused', 'late-unsafe']) {
    const app = signOutFixture()
    if (failure === 'unsafe') app.prepareWith(async () => ({ ready: false, reason: 'Keep the attachment' }))
    if (failure === 'save-error') app.prepareWith(async () => { throw new Error('Save failed') })
    if (failure === 'logout-error') app.logoutWith(async () => { throw new Error('Logout failed') })
    if (failure === 'logout-refused') app.logoutWith(async () => ({ ok: false }))
    if (failure === 'late-unsafe') app.prepareWith(async () => app.calls().preparations === 1 ? { ready: true } : { ready: false, reason: 'Recording started' })
    await assert.rejects(app.signOut())
    assert.equal(app.root.inert, false, failure)
    assert.equal(app.calls().reloads, 0, failure)
    assert.equal(app.connection.load().token, 'synthetic-session-token', failure)
    if (['unsafe', 'save-error'].includes(failure)) assert.equal(app.calls().logouts, 0, failure)
    const release = app.transitions.beginBrowserTransition()
    assert.equal(typeof release, 'function', failure)
    release()
  }
})

test('sign-out verifies credential removal before reloading and unlocks on storage failure', async () => {
  const app = signOutFixture()
  app.store.setItem = () => { throw new Error('Storage unavailable') }
  await assert.rejects(app.signOut(), /saved sign-in could not be cleared/)
  assert.equal(app.calls().reloads, 0)
  assert.equal(app.root.inert, false)
})
