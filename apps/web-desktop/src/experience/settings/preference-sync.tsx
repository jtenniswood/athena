import { useState, useSyncExternalStore } from 'react'
import { applySyncedPreferences, preferenceSyncStatus, subscribePreferenceSync } from '../../platform/preference-sync'

export function BrowserPreferenceSync() {
  const status = useSyncExternalStore(subscribePreferenceSync, preferenceSyncStatus, preferenceSyncStatus)
  const [error, setError] = useState('')
  const messages = {
    loading: 'Connecting settings sync…', saved: 'Settings saved to your account.',
    saving: 'Saving settings…', offline: 'Settings sync is unavailable. Reconnect to retry saving.',
    'account-changed': 'Your signed-in account changed. Reopen Athena to load its settings.'
  }
  return <section aria-labelledby="browser-preference-sync-title">
    <h3 id="browser-preference-sync-title">Sync across devices</h3>
    <p role="status">{messages[status.state]}</p>
    {status.remoteChanges && status.state !== 'account-changed' && <>
      <p>Settings changed on another device.</p>
      <button type="button" onClick={() => {
        setError('')
        void applySyncedPreferences().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not apply settings. Try again.'))
      }}>Apply changes</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>
}
