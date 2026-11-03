import { useState, useSyncExternalStore } from 'react'
import { applySyncedPreferences, preferenceSyncStatus, subscribePreferenceSync } from '../../platform/preference-sync'
import { useSettingsPresentation } from './presentation'

export function BrowserPreferenceSync() {
  const status = useSyncExternalStore(subscribePreferenceSync, preferenceSyncStatus, preferenceSyncStatus)
  const [error, setError] = useState('')
  const messages = {
    loading: 'Connecting settings sync…', saved: 'Settings saved to your account.',
    saving: 'Saving settings…', offline: 'Settings sync is unavailable. Reconnect to retry saving.',
    'account-changed': 'Your signed-in account changed. Reopen Athena to load its settings.'
  }
  const apply = () => {
    setError('')
    void applySyncedPreferences().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not apply settings. Try again.'))
  }
  const canApply = status.remoteChanges && status.state !== 'account-changed'
  const presentation = useSettingsPresentation([
    { kind: 'heading', label: 'Sync across devices' },
    { kind: 'text', label: messages[status.state] },
    ...(canApply ? [{ kind: 'text' as const, label: 'Settings changed on another device.' },
      { id: 'apply', kind: 'action' as const, label: 'Apply changes', run: apply }] : []),
    ...(error ? [{ kind: 'text' as const, label: error }] : [])
  ])
  return <section ref={presentation} aria-labelledby="browser-preference-sync-title">
    <h3 id="browser-preference-sync-title">Sync across devices</h3>
    <p role="status">{messages[status.state]}</p>
    {canApply && <>
      <p>Settings changed on another device.</p>
      <button type="button" onClick={apply}>Apply changes</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>
}
