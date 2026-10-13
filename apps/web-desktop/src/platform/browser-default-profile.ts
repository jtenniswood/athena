import { WEB_CONNECTION_ID } from './connection'
import { createBrowserDefaultProfileRoute } from './default-profile-route'

/** One preference owner for the bridge, profile menu and new-session commands. */
export const browserDefaultProfile = createBrowserDefaultProfileRoute(
  () => window.localStorage,
  WEB_CONNECTION_ID,
  {
    subscribe: listener => {
      const onStorage = (event: StorageEvent) => listener(event.key, event.newValue)
      window.addEventListener('storage', onStorage)
      return () => window.removeEventListener('storage', onStorage)
    }
  }
)
