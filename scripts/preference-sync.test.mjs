import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as schema from './preference-schema.mjs'
import { createPreferenceStore } from './preferences-server.mjs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const context = vm.createContext({ exports: {}, require: name => name.includes('preference-schema') ? schema : {}, TextEncoder })
vm.runInContext(ts.transpileModule(readFileSync(new URL('../apps/web-desktop/src/platform/preference-sync.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, context)
const { createPreferenceSync } = context.exports
const theme = 'hermes-desktop-theme-v2', sidebar = 'hermes-web.browser.navigation-width'
const accountA = 'a'.repeat(64), accountB = 'b'.repeat(64)
function storage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'athena-sync-client-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const server = createPreferenceStore(directory)
  let account = accountA, online = true, hold
  const request = async body => {
    if (!online) throw new Error('Offline')
    if (hold) { const gate = hold; hold = undefined; await gate }
    if (body && body.accountId !== account) throw Object.assign(new Error('Account changed'), { accountChanged: true })
    const saved = body ? await server.patch(account, body.changes, body.seed) : await server.read(account)
    return { ...saved, accountId: account }
  }
  return { server, request, account: value => { account = value }, online: value => { online = value }, hold: value => { hold = value } }
}

test('first-device migration loads on a second device and concurrent devices merge different keys', async t => {
  const f = await fixture(t)
  const first = storage({ [theme]: 'dark', 'hermes:composer-drafts:v3': 'private draft', 'hermes-web.session-token': 'secret' })
  const a = createPreferenceSync(first, 'gateway', f.request, () => {})
  await a.initialize(); await a.flush()
  const second = storage({ [theme]: 'old-device-theme' })
  const b = createPreferenceSync(second, 'gateway', f.request, () => {})
  await b.initialize()
  assert.equal(second.getItem(theme), 'dark')
  assert.equal(second.getItem('hermes:composer-drafts:v3'), null)
  const snapshot = await f.server.read(accountA)
  assert.equal(snapshot.values['hermes-web.session-token'], undefined)
  first.setItem(theme, 'light'); a.capture()
  second.setItem(sidebar, '400'); b.capture()
  await Promise.all([a.flush(), b.flush()])
  const merged = await f.server.read(accountA)
  assert.equal(merged.values[theme], 'light')
  assert.equal(merged.values[sidebar], '400')
  await b.refresh()
  assert.equal(b.status().remoteChanges, true)
  assert.equal(second.getItem(theme), 'dark', 'live renderer preferences wait for safe application')
  await b.applyRemote()
  assert.equal(second.getItem(theme), 'light')
})

test('offline edits survive reopening, retry on reconnect, and preserve edits during a save', async t => {
  const f = await fixture(t), local = storage({ [theme]: 'dark' })
  const a = createPreferenceSync(local, 'gateway', f.request, () => {})
  await a.initialize(); await a.flush()
  f.online(false)
  local.setItem(theme, 'light'); a.capture(); await a.flush()
  assert.equal(a.status().state, 'offline')
  assert.equal((await a.prepare()).ready, true, 'a durable offline outbox does not block safe updates')
  const reopened = createPreferenceSync(local, 'gateway', f.request, () => {})
  await reopened.initialize()
  local.setItem(sidebar, '450'); reopened.capture()
  f.online(true)
  let release
  f.hold(new Promise(resolve => { release = resolve }))
  const saving = reopened.flush()
  await new Promise(resolve => setImmediate(resolve))
  local.setItem(theme, 'system'); reopened.capture()
  release(); await saving
  const saved = await f.server.read(accountA)
  assert.equal(saved.values[theme], 'system')
  assert.equal(saved.values[sidebar], '450')
  assert.equal(reopened.status().state, 'saved')
})

test('account switches do not import another account preferences or change drafts', async t => {
  const f = await fixture(t), local = storage({ [theme]: 'dark', 'hermes:composer-drafts:v3': 'keep draft' })
  const a = createPreferenceSync(local, 'gateway', f.request, () => {})
  await a.initialize(); await a.flush()
  local.setItem(theme, 'light'); a.capture()
  f.account(accountB)
  await a.flush()
  assert.equal(a.status().state, 'account-changed')
  const b = createPreferenceSync(local, 'gateway', f.request, () => {})
  await b.initialize(); await b.flush()
  assert.equal(local.getItem(theme), null)
  assert.equal(local.getItem('hermes:composer-drafts:v3'), 'keep draft')
  assert.deepEqual((await f.server.read(accountB)).values, {})
  a.capture()
  f.account(accountA)
  const returning = createPreferenceSync(local, 'gateway', f.request, () => {})
  await returning.initialize(); await returning.flush()
  assert.equal(local.getItem(theme), 'light', 'the original account retains its own offline outbox')
})

test('two first-device imports cannot overwrite existing keys or revive deleted settings', async t => {
  const f = await fixture(t), left = storage({ [theme]: 'dark' }), right = storage({ [theme]: 'light', [sidebar]: '350' })
  const a = createPreferenceSync(left, 'gateway', f.request, () => {}), b = createPreferenceSync(right, 'gateway', f.request, () => {})
  await Promise.all([a.initialize(), b.initialize()])
  await a.flush(); await b.flush()
  assert.equal((await f.server.read(accountA)).values[theme], 'dark')
  assert.equal((await f.server.read(accountA)).values[sidebar], '350')
  left.removeItem(theme); a.capture(); await a.flush()
  const fresh = storage({ [theme]: 'stale' }), c = createPreferenceSync(fresh, 'gateway', f.request, () => {})
  await c.initialize(); await c.flush()
  assert.equal(fresh.getItem(theme), null)
  assert.equal((await f.server.read(accountA)).values[theme], null)
})

test('applying remote preferences respects a late safety refusal and edits made while fetching', async t => {
  const f = await fixture(t), local = storage({ [theme]: 'dark' })
  const a = createPreferenceSync(local, 'gateway', f.request, () => {})
  await a.initialize(); await a.flush()
  await f.server.patch(accountA, { [theme]: 'light' })
  await assert.rejects(a.applyRemote(async () => { throw new Error('Finish recording first.') }), /Finish recording/)
  assert.equal(local.getItem(theme), 'dark')
  await assert.rejects(a.applyRemote(async () => { local.setItem(theme, 'system') }), /Local settings changed/)
  assert.equal(local.getItem(theme), 'system')
  await a.flush()
  assert.equal((await f.server.read(accountA)).values[theme], 'system')
})
