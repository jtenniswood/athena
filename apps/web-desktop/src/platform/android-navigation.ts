import { androidNavigationReady, isAndroidApp } from './android'
import { reloadReadinessAfterSaving } from './reload-safety'

/** Native reload and server changes share the web app's draft and recording guards. */
export function installAndroidNavigationGuard(): () => void {
  if (!isAndroidApp()) return () => {}
  const prepare = (event: Event) => {
    event.preventDefault()
    const requestId = (event as CustomEvent<{ requestId?: string }>).detail?.requestId
    // Cold sign-in has not mounted the renderer or opened a composer yet.
    if (document.getElementById('root')?.firstElementChild?.classList.contains('athena-sign-in')) {
      void androidNavigationReady({ ready: true, requestId })
      return
    }
    void reloadReadinessAfterSaving()
      .then(result => androidNavigationReady({ ready: result.ready, reason: result.reason, requestId }))
      .catch(() => androidNavigationReady({ ready: false, requestId, reason: 'Your draft could not be saved. Copy it before leaving.' }))
  }
  window.addEventListener('athena:prepare-native-navigation', prepare)
  return () => window.removeEventListener('athena:prepare-native-navigation', prepare)
}
