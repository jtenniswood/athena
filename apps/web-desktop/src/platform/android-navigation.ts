import { androidNavigationReady, isAndroidApp } from './android'
import { chatSelectionReadiness, reloadReadinessAfterSaving } from './reload-safety'

/** Native reload and server changes share the web app's draft and recording guards. */
export function installAndroidNavigationGuard(): () => void {
  if (!isAndroidApp()) return () => {}
  const prepare = (event: Event) => {
    event.preventDefault()
    const { requestId, chatSelection } = (event as CustomEvent<{ requestId?: string; chatSelection?: boolean }>).detail ?? {}
    const root = document.getElementById('root')
    // Cold sign-in has not mounted the renderer or opened a composer yet.
    if (root?.firstElementChild?.classList.contains('athena-sign-in')) {
      void androidNavigationReady({ ready: true, requestId })
      return
    }
    if (chatSelection) {
      const result = root?.inert ? { ready: false, reason: 'Wait for Athena to finish updating.' } : chatSelectionReadiness()
      void androidNavigationReady({ ...result, requestId })
      return
    }
    void reloadReadinessAfterSaving()
      .then(result => androidNavigationReady({ ready: result.ready, reason: result.reason, requestId }))
      .catch(() => androidNavigationReady({ ready: false, requestId, reason: 'Your draft could not be saved. Copy it before leaving.' }))
  }
  window.addEventListener('athena:prepare-native-navigation', prepare)
  return () => window.removeEventListener('athena:prepare-native-navigation', prepare)
}
