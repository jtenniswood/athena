import { androidNavigationReady, isAndroidApp } from './android'
import { reloadReadinessAfterSaving } from './reload-safety'

/** Native reload and server changes share the web app's draft and recording guards. */
export function installAndroidNavigationGuard(): () => void {
  if (!isAndroidApp()) return () => {}
  const prepare = (event: Event) => {
    event.preventDefault()
    // Cold sign-in has not mounted the renderer or opened a composer yet.
    if (document.getElementById('root')?.firstElementChild?.classList.contains('athena-sign-in')) {
      void androidNavigationReady({ ready: true })
      return
    }
    void reloadReadinessAfterSaving()
      .then(result => androidNavigationReady({ ready: result.ready, reason: result.reason }))
      .catch(() => androidNavigationReady({ ready: false, reason: 'Your draft could not be saved. Copy it before leaving.' }))
  }
  window.addEventListener('athena:prepare-native-navigation', prepare)
  return () => window.removeEventListener('athena:prepare-native-navigation', prepare)
}
