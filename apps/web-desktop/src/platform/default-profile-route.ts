import { browserPreferences, parseBrowserPreference } from '../../../../scripts/browser-preference-contract.mjs'
export interface BrowserProfileRoute {
  connectionId: null | string
  profile: string
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type StorageChanges = {
  subscribe: (listener: (key: null | string, value: null | string) => void) => () => void
}

const storageKey = browserPreferences.defaultProfile.key

function decode(value: null | string, connectionId: string): BrowserProfileRoute | null {
  const route = parseBrowserPreference(browserPreferences.defaultProfile, value)
  return route && (!route.connectionId || route.connectionId === connectionId) ? { ...route, connectionId } : null
}

export function createBrowserDefaultProfileRoute(
  getStorage: () => StorageLike,
  connectionId: string,
  storageChanges: StorageChanges
) {
  const listeners = new Set<(route: BrowserProfileRoute | null) => void>()

  const getSnapshot = (): BrowserProfileRoute | null => {
    try {
      return decode(getStorage().getItem(storageKey), connectionId)
    } catch {
      return null
    }
  }

  const getDefault = async (): Promise<BrowserProfileRoute | null> => getSnapshot()

  const clearDefault = async (): Promise<void> => {
    getStorage().removeItem(storageKey)
    for (const listener of listeners) listener(null)
  }

  const setDefault = async (route: BrowserProfileRoute): Promise<BrowserProfileRoute> => {
    if (route.connectionId && route.connectionId !== connectionId) {
      throw new Error('The browser can only save a profile on its configured gateway.')
    }
    const saved = { connectionId, profile: route.profile.trim() || 'default' }
    getStorage().setItem(storageKey, JSON.stringify(saved))
    for (const listener of listeners) listener(saved)
    return saved
  }

  const onDefaultChanged = (callback: (route: BrowserProfileRoute | null) => void): (() => void) => {
    listeners.add(callback)
    const unsubscribeStorage = storageChanges.subscribe((key, value) => {
      if (key === null) {
        callback(null)
      } else if (key === storageKey) {
        const route = decode(value, connectionId)
        if (route || value === null) callback(route)
      }
    })
    return () => {
      listeners.delete(callback)
      unsubscribeStorage()
    }
  }

  return { getSnapshot, getDefault, setDefault, clearDefault, onDefaultChanged }
}
