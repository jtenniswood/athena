import { WEB_CONNECTION_ID } from './connection'
import { createBrowserDefaultProfileRoute } from './default-profile-route'
import { saveSyncedPreference } from './preference-sync'

/** One preference owner for the bridge, profile menu and new-session commands. */
export const browserDefaultProfile = createBrowserDefaultProfileRoute(
  () => ({
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => saveSyncedPreference(key, value, true),
    removeItem: key => saveSyncedPreference(key, null, true)
  }),
  WEB_CONNECTION_ID,
  {
    subscribe: listener => {
      const onStorage = (event: StorageEvent) => listener(event.key, event.newValue)
      window.addEventListener('storage', onStorage)
      return () => window.removeEventListener('storage', onStorage)
    }
  }
)
