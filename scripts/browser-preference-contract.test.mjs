import assert from 'node:assert/strict'
import { test } from 'node:test'
import { browserPreferences as definitions, createBrowserPreference, parseBrowserPreference, migrateBrowserPreference, wrapperSyncPreferenceKeys } from './browser-preference-contract.mjs'
import { preferenceKeys } from './preference-schema.mjs'

function harness(definition, initial = {}) {
  const values = new Map(Object.entries(initial)), events = new EventTarget(), writes = []
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const persist = (key, value) => { writes.push([key, value]); value === null ? storage.removeItem(key) : storage.setItem(key, value) }
  return { values, events, writes, storage, persist, store: createBrowserPreference(definition, { storage: () => storage, persist, events }) }
}
test('existing preference formats retain defaults and conservative malformed-value behavior', () => {
  const parse = (id, raw) => parseBrowserPreference(definitions[id], raw)
  assert.equal(parse('followupBehavior', null), 'queue')
  assert.equal(parse('followupBehavior', 'steer'), 'steer')
  assert.equal(parse('followupBehavior', 'future'), 'queue')
  assert.equal(parse('auxiliaryTranscript', 'false'), false)
  assert.equal(parse('auxiliaryTranscript', '{bad'), true)
  assert.deepEqual(parse('navigationTabs', '["bots","future","bots"]'), ['bots'])
  assert.deepEqual(parse('navigationTabs', '[]'), ['sessions', 'bots'])
  assert.deepEqual(parse('navigationTabs', '{bad'), ['sessions', 'bots'])
  assert.deepEqual(parse('hiddenProfiles', '["research",null,5]'), ['research'])
  assert.equal(parse('navigationWidth', null), 224)
  assert.equal(parse('navigationWidth', 'bad'), 304)
  assert.equal(parse('navigationWidth', '9999'), 560)
  assert.equal(parse('mobileScale', '0'), 125)
  assert.equal(parse('desktopScale', '150'), 150)
  assert.equal(parse('defaultProfile', '{bad'), null)
  assert.deepEqual(parse('defaultProfile', '{"connectionId":null,"profile":""}'), { connectionId: null, profile: 'default' })
})
test('same-tab writes and relevant cross-tab changes refresh stable snapshots and dispose subscriptions', () => {
  const h = harness(definitions.navigationTabs)
  assert.equal(h.store.read(), h.store.read())
  let calls = 0
  const dispose = h.store.subscribe(() => calls++)
  h.store.write(['bots'])
  assert.equal(calls, 1)
  assert.deepEqual(h.store.read(), ['bots'])
  h.values.set(definitions.navigationTabs.key, '["sessions"]')
  const event = key => Object.assign(new Event('storage'), { key })
  h.events.dispatchEvent(event('unrelated'))
  assert.equal(calls, 1)
  h.events.dispatchEvent(event(definitions.navigationTabs.key))
  assert.equal(calls, 2)
  assert.deepEqual(h.store.read(), ['sessions'])
  h.values.clear()
  h.events.dispatchEvent(event(null))
  assert.deepEqual(h.store.read(), ['sessions', 'bots'])
  dispose()
  h.store.write(['bots'])
  assert.equal(calls, 3)
})
test('optional preferences tolerate blocked storage while required preferences propagate write failures', () => {
  const environment = { storage() { throw Error('Blocked') }, persist() { throw Error('Blocked') }, events: new EventTarget() }
  const optional = createBrowserPreference(definitions.followupBehavior, environment)
  assert.equal(optional.read(), 'queue')
  assert.doesNotThrow(() => optional.write('steer'))
  const visibility = createBrowserPreference(definitions.hiddenSections, environment)
  visibility.write(['pinned'])
  assert.deepEqual(visibility.read(), ['pinned'])
  assert.throws(() => createBrowserPreference(definitions.defaultProfile, environment).write({ profile: 'research', connectionId: null }), /Blocked/)
})
test('legacy sidebar migrations retain stable identities and are idempotent', () => {
  const definition = definitions.hiddenSections
  for (const legacy of ['["projects","telegram","telegram","sessions","a-project","__proto__"]', null]) {
    const h = harness(definition, legacy ? { [definition.key]: legacy } : { 'hermes-web.browser.cron-section-hidden': 'true' })
    const expected = legacy ? ['messaging:telegram', 'a-project', '__proto__'] : ['cron-jobs']
    assert.deepEqual(h.store.read(), expected)
    assert.equal(migrateBrowserPreference(definition, h.storage, h.persist), true)
    assert.deepEqual(JSON.parse(h.values.get(definition.key)), { version: 2, hidden: expected })
    assert.equal(migrateBrowserPreference(definition, h.storage, h.persist), false)
    assert.equal(h.writes.length, 1)
    assert.deepEqual(h.store.read(), expected)
  }
  const malformed = harness(definition, { [definition.key]: '{bad' })
  assert.deepEqual(malformed.store.read(), [])
  assert.equal(migrateBrowserPreference(definition, malformed.storage, malformed.persist), false)
  assert.equal(malformed.values.get(definition.key), '{bad')
})
test('session migration preserves its input until a verified write and never replaces a current profile', () => {
  const definition = definitions.sessionProfile, legacy = definition.migration.legacyKeys[0]
  const h = harness(definition, { [legacy]: 'research' })
  assert.equal(migrateBrowserPreference(definition, h.storage, () => {}), false)
  assert.equal(h.values.get(legacy), 'research')
  assert.equal(migrateBrowserPreference(definition, h.storage, h.persist), true)
  assert.equal(h.values.has(legacy), false)
  assert.equal(migrateBrowserPreference(definition, h.storage, h.persist), false)
  h.values.set(legacy, 'old')
  h.values.set(definition.key, 'current')
  assert.equal(migrateBrowserPreference(definition, h.storage, h.persist), true)
  assert.equal(h.values.get(definition.key), 'current')
  assert.equal(h.writes.length, 1)
})
test('the server uses the same wrapper preference keys and excludes session, credentials, and draft owners', () => {
  for (const definition of Object.values(definitions)) {
    assert.ok(definition.owner && definition.migration.rule && definition.parse && definition.serialize)
    assert.equal(preferenceKeys.includes(definition.key), definition.scope !== 'session')
  }
  assert.equal(new Set(wrapperSyncPreferenceKeys).size, wrapperSyncPreferenceKeys.length)
  assert.ok(!preferenceKeys.includes('hermes:composer-drafts:v3'))
  assert.ok(!preferenceKeys.includes('hermes-web.connection.v2.web'))
})
