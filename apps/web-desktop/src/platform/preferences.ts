import { useSyncExternalStore } from 'react'
import { browserPreferences, createBrowserPreference, type PreferenceValues, type PreferenceDefinition } from '../../../../scripts/browser-preference-contract.mjs'
import { saveSyncedPreference } from './preference-sync'

export { browserPreferences, parseBrowserPreference } from '../../../../scripts/browser-preference-contract.mjs'
const stores = new Map<string, unknown>()
type SyncedPreference = Exclude<keyof PreferenceValues, 'sessionProfile'>

export function browserPreference<K extends SyncedPreference>(id: K) {
  const definition = browserPreferences[id] as PreferenceDefinition<PreferenceValues[K]>
  let store = stores.get(id) as ReturnType<typeof createBrowserPreference<PreferenceValues[K]>> | undefined
  if (!store) {
    store = createBrowserPreference(definition, { storage: () => window.localStorage, persist: saveSyncedPreference, events: window })
    stores.set(id, store)
  }
  return store as ReturnType<typeof createBrowserPreference<PreferenceValues[K]>>
}
export function useBrowserPreference<K extends SyncedPreference>(id: K): PreferenceValues[K] {
  const store = browserPreference(id)
  return useSyncExternalStore(store.subscribe, store.read, () => browserPreferences[id].defaultValue)
}
