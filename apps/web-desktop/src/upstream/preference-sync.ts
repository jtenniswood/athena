import { onPersistenceEvent } from '@/lib/storage'
import { isPreferenceKey } from '../../../../scripts/preference-schema.mjs'
import { capturePreferenceChanges } from '../platform/preference-sync'
import { refreshBrowserPush } from '../platform/browser-push'
import { syncAndroidPushPreferences } from '../platform/android-push'

/** Observe the engine's existing storage owner; never mirror its mutable stores. */
export function observeRendererPreferences(): void {
  onPersistenceEvent(event => {
    if (event.op === 'read') return
    if (isPreferenceKey(event.key)) capturePreferenceChanges()
    if (event.key === 'hermes:native-notifications' || event.key === 'hermes.desktop.hapticsMuted') {
      void syncAndroidPushPreferences()
      void refreshBrowserPush()
    }
  })
}
