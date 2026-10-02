export interface BrowserProfileRoute {
  connectionId: null | string
  profile: string
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
type StorageChanges = {
  subscribe: (listener: (key: null | string, value: null | string) => void) => () => void
}

const storageKey = 'hermes-web.default-profile-route.v1'

function decode(value: null | string, connectionId: string): BrowserProfileRoute | null {
  if (!value) return null
  try {
    const route: unknown = JSON.parse(value)
    if (typeof route !== 'object' || route === null) return null
    const candidate = route as Partial<BrowserProfileRoute>
    if (typeof candidate.profile !== 'string' || (candidate.connectionId !== null && typeof candidate.connectionId !== 'string')) return null
    if (candidate.connectionId && candidate.connectionId !== connectionId) return null
    return { connectionId, profile: candidate.profile || 'default' }
  } catch {
    return null
  }
}

export function createBrowserDefaultProfileRoute(
  getStorage: () => StorageLike,
  connectionId: string,
  storageChanges: StorageChanges
) {
  const listeners = new Set<(route: BrowserProfileRoute | null) => void>()

  const getDefault = async (): Promise<BrowserProfileRoute | null> => {
    try {
      return decode(getStorage().getItem(storageKey), connectionId)
    } catch {
      return null
    }
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

  return { getDefault, setDefault, onDefaultChanged }
}
