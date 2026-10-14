// Stable wire formats shared by browser owners and the server sync allowlist.
export const NAVIGATION_TABS = ['sessions', 'bots']
export const MIN_NAVIGATION_WIDTH = 224
export const MAX_NAVIGATION_WIDTH = 560
export const DEFAULT_NAVIGATION_WIDTH = 304
const empty = Object.freeze([])
const json = raw => JSON.parse(raw || 'null')
const strings = values => values.filter(value => typeof value === 'string')
export const clampNavigationWidth = width => Math.min(MAX_NAVIGATION_WIDTH, Math.max(MIN_NAVIGATION_WIDTH, width))
const legacySections = {
  projects: 'sessions', telegram: 'messaging:telegram', discord: 'messaging:discord', slack: 'messaging:slack',
  mattermost: 'messaging:mattermost', matrix: 'messaging:matrix', signal: 'messaging:signal',
  whatsapp: 'messaging:whatsapp', imessage: 'messaging:bluebubbles', photon: 'messaging:photon',
  homeassistant: 'messaging:homeassistant', email: 'messaging:email', sms: 'messaging:sms',
  webhook: 'messaging:webhook', api: 'messaging:api_server', wechat: 'messaging:weixin',
  wecom: 'messaging:wecom', qq: 'messaging:qqbot', yuanbao: 'messaging:yuanbao',
  dingtalk: 'messaging:dingtalk', feishu: 'messaging:feishu'
}
function definition(key, owner, defaultValue, parse, serialize = String, extra = {}) {
  return Object.freeze({ key, owner, scope: 'browser', durability: 'optional', defaultValue, parse, serialize,
    migration: { legacyKeys: [], rule: 'Keep the existing key and wire format.' }, ...extra })
}
const list = raw => { const value = json(raw); return Array.isArray(value) ? strings(value) : [] }
const scale = raw => { const value = Number(raw); return Number.isFinite(value) && value > 0 ? value : 125 }
export const browserPreferences = Object.freeze({
  activeTab: definition('hermes-web.browser.navigation', 'experience/browser-preferences', 'sessions', raw => raw === 'bots' ? 'bots' : 'sessions'),
  hiddenProfiles: definition('hermes-web.browser.hidden-profiles', 'experience/browser-preferences', empty, list, JSON.stringify),
  hideAllProfilesButton: definition('hermes-web.browser.hide-all-profiles-button', 'experience/browser-preferences', false, raw => raw === 'true'),
  navigationTabs: definition('hermes-web.browser.navigation-tabs', 'experience/browser-preferences', NAVIGATION_TABS, raw => {
    const value = json(raw)
    if (!Array.isArray(value)) return [...NAVIGATION_TABS]
    const visible = [...new Set(value.filter(tab => NAVIGATION_TABS.includes(tab)))]
    return visible.length ? visible : [...NAVIGATION_TABS]
  }, JSON.stringify),
  // Preserve the existing Number(null) -> 0 -> minimum-width behavior.
  navigationWidth: definition('hermes-web.browser.navigation-width', 'experience/browser-preferences', MIN_NAVIGATION_WIDTH, raw => {
    const value = Number(raw)
    return Number.isFinite(value) ? clampNavigationWidth(value) : DEFAULT_NAVIGATION_WIDTH
  }),
  followupBehavior: definition('hermes-web.browser.followup-behavior', 'experience/followup-preferences', 'queue', raw => raw === 'steer' ? 'steer' : 'queue', String,
    { changeEvent: 'hermes-web:followup-behavior-change' }),
  auxiliaryTranscript: definition('hermes-web.browser.show-auxiliary-transcript-content', 'experience/transcript-preferences', true, raw => raw !== 'false', String,
    { changeEvent: 'hermes-web:transcript-preferences-change' }),
  hiddenSections: definition('hermes-web.browser.hidden-sections', 'experience/sidebar-sections', empty, (raw, storage) => {
    const value = json(raw)
    if (value?.version === 2 && Array.isArray(value.hidden)) return [...new Set(strings(value.hidden).filter(key => key !== 'sessions'))]
    if (Array.isArray(value)) return [...new Set(strings(value).map(key => Object.hasOwn(legacySections, key) ? legacySections[key] : key).filter(key => key !== 'sessions'))]
    return [storage?.getItem('hermes-web.browser.pinned-section-hidden') === 'true' ? 'pinned' : null,
      storage?.getItem('hermes-web.browser.cron-section-hidden') === 'true' ? 'cron-jobs' : null].filter(Boolean)
  }, hidden => JSON.stringify({ version: 2, hidden }), { memoryOnFailure: true, migration: {
    legacyKeys: ['hermes-web.browser.pinned-section-hidden', 'hermes-web.browser.cron-section-hidden'],
    rule: 'Read legacy label arrays or independent flags; write stable section identities in version 2. Never hide sessions.',
    transform: (raw, storage) => {
      const value = json(raw)
      if (Array.isArray(value) || (!value && browserPreferences.hiddenSections.migration.legacyKeys.some(key => storage.getItem(key) === 'true'))) {
        return { value: browserPreferences.hiddenSections.serialize(browserPreferences.hiddenSections.parse(raw, storage)) }
      }
    }
  } }),
  desktopScale: definition('hermes-web.ui-scale', 'platform/display', 125, scale),
  mobileScale: definition('hermes-web.ui-scale.mobile', 'platform/display', 125, scale),
  defaultProfile: definition('hermes-web.default-profile-route.v1', 'platform/default-profile-route', null, raw => {
    const value = json(raw)
    if (!value || typeof value.profile !== 'string' || (value.connectionId !== null && typeof value.connectionId !== 'string')) return null
    return { connectionId: value.connectionId, profile: value.profile || 'default' }
  }, JSON.stringify, { scope: 'connection', durability: 'required' }),
  sessionProfile: definition('hermes-web.browser.profile', 'experience/browser-experience', null, raw => raw || null, String, {
    scope: 'session', migration: { legacyKeys: ['hermes-web.comparison.profile'], rule: 'Copy the legacy session profile before removing its key.',
      transform: (raw, storage) => {
        const legacy = storage.getItem('hermes-web.comparison.profile')
        if (legacy) return { value: raw || legacy, remove: ['hermes-web.comparison.profile'] }
      }
    }
  })
})
export const wrapperSyncPreferenceKeys = Object.values(browserPreferences).filter(item => item.scope !== 'session').map(item => item.key)

/** Optional preferences never replace these owners' stricter persistence rules. */
export const browserStorageOwners = Object.freeze([
  { key: 'hermes-web.connection.v2.<gatewayId>', owner: 'platform/connection-state', scope: 'connection', durability: 'verified',
    parser: 'BrowserConnectionStateV2', default: 'OAuth with no token', migration: 'Verify version 2 before completing a conservative credential migration.' },
  { key: '<registered engine draft key>', owner: 'platform/draft-persistence and platform/draft-safety', scope: 'conversation', durability: 'verified',
    parser: 'Record<string, string>', default: {}, migration: 'Retain the engine format; flush and verify drafts before lifecycle transitions.' },
  { key: 'athena.preferences.owner.<gatewayId> / athena.preferences.outbox.<gatewayId>.<accountId>', owner: 'platform/preference-sync', scope: 'account', durability: 'verified',
    parser: 'Account identity and version 1 allowlisted outbox', default: {}, migration: 'Seed unowned preferences once; never upload another account’s values.' },
  { key: 'hermes-web.startup-chunk-retry / athena.startup-return-hash', owner: 'platform/startup-recovery', scope: 'session', durability: 'optional',
    parser: 'Build revision and safe browser hash', default: null, migration: 'Transient startup markers; no preference sync.' }
])

export function parseBrowserPreference(definition, raw, storage) {
  try { return definition.parse(raw, storage) } catch { return definition.defaultValue }
}

/** Never remove migration inputs until the new value is confirmed in storage. */
export function migrateBrowserPreference(definition, storage, persist) {
  try {
    const raw = storage.getItem(definition.key)
    const migration = definition.migration.transform?.(raw, storage)
    if (!migration) return false
    if (raw !== migration.value) persist(definition.key, migration.value)
    if (storage.getItem(definition.key) !== migration.value) return false
    for (const key of migration.remove || []) storage.removeItem(key)
    return true
  } catch { return false }
}

/** A stable snapshot and one subscription path for same-tab and cross-tab writes. */
export function createBrowserPreference(definition, environment) {
  let fingerprint, memory, snapshot = definition.defaultValue
  const read = () => {
    try {
      const storage = environment.storage()
      const raw = storage.getItem(definition.key)
      const next = JSON.stringify([raw, ...definition.migration.legacyKeys.map(key => storage.getItem(key))])
      if (memory && next === memory.fingerprint) return memory.value
      memory = undefined
      if (next !== fingerprint) { fingerprint = next; snapshot = parseBrowserPreference(definition, raw, storage) }
      return snapshot
    } catch { fingerprint = undefined; return memory ? memory.value : definition.defaultValue }
  }
  const eventName = definition.changeEvent || `athena:preference:${definition.key}`
  const writeRaw = raw => {
    read()
    const previous = fingerprint
    try { environment.persist(definition.key, raw, definition.durability === 'required') }
    catch (error) { if (definition.durability === 'required') throw error }
    if (definition.memoryOnFailure) {
      try { memory = environment.storage().getItem(definition.key) === raw ? undefined : { fingerprint: previous, value: parseBrowserPreference(definition, raw) } }
      catch { memory = { fingerprint: previous, value: parseBrowserPreference(definition, raw) } }
    }
    environment.events.dispatchEvent(new Event(eventName))
  }
  return {
    read,
    writeRaw,
    write: value => writeRaw(definition.serialize(value)),
    subscribe: listener => {
      const storageChanged = event => {
        try { if (event.storageArea && event.storageArea !== environment.storage()) return } catch { return }
        if (event.key === null || event.key === definition.key || definition.migration.legacyKeys.includes(event.key)) listener()
      }
      environment.events.addEventListener(eventName, listener)
      environment.events.addEventListener('storage', storageChanged)
      return () => {
        environment.events.removeEventListener(eventName, listener)
        environment.events.removeEventListener('storage', storageChanged)
      }
    }
  }
}
