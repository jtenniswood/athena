import { installOfficialHostTransport } from '../platform/official-host'
import { isSharedPreferenceKey } from '@/lib/ui-preferences/keys'
import { preferenceKeys } from '../../../../scripts/preference-schema.mjs'
import type { PreferenceSyncOptions } from '../platform/preference-sync'

/** Athena syncs its extensions; the released bridge syncs renderer preferences. */
export function officialPreferenceOwnership(): PreferenceSyncOptions {
  return {
    keys: preferenceKeys.filter(key => !isSharedPreferenceKey(key)),
    importLegacy(values) {
      for (const [key, value] of Object.entries(values)) {
        if (value !== null && isSharedPreferenceKey(key) && localStorage.getItem(key) === null) {
          localStorage.setItem(key, value)
        }
      }
    }
  }
}

/** Admit the release's credential owner before Athena's account services load. */
export async function initializeOfficialBrowserTransport(): Promise<void> {
  const { browserApi, browserBootstrap } = await import('@/lib/browser-transport')
  const bootstrap = browserBootstrap()
  if (!bootstrap) throw new Error('The Hermes Webapp bootstrap is unavailable.')
  installOfficialHostTransport({ api: request => browserApi(bootstrap, request), token: () => browserBootstrap()?.token || '' })
}
