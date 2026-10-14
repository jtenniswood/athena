import { onPersistenceEvent } from '@/lib/storage'
import { isPreferenceKey } from '../../../../scripts/preference-schema.mjs'
import { capturePreferenceChanges } from '../platform/preference-sync'

/** Observe the engine's existing storage owner; never mirror its mutable stores. */
export function observeRendererPreferences(): void {
  onPersistenceEvent(event => {
    if (event.op !== 'read' && isPreferenceKey(event.key)) capturePreferenceChanges()
  })
}
