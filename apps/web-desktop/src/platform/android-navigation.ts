import { androidNavigationReady, isAndroidApp } from './android'
import { chatSelectionReadiness, reloadReadinessAfterSaving } from './reload-safety'

/** Native reload and server changes share the web app's draft and recording guards. */
export function installAndroidNavigationGuard(): () => void {
  if (!isAndroidApp()) return () => {}
  const prepare = async (event: Event) => {
    event.preventDefault()
    const { requestId, chatSelection } = (event as CustomEvent<{ requestId?: string; chatSelection?: boolean }>).detail ?? {}
    const root = document.getElementById('root')
    const transitioning = () => root?.inert || document.body?.inert
    const postponed = { ready: false, reason: 'Wait for Athena to finish updating.' }
    let result: { ready: boolean; reason?: string }
    try {
      if (transitioning()) result = postponed
      // Cold sign-in has not mounted the renderer or opened a composer yet.
      else if (root?.firstElementChild?.classList.contains('athena-sign-in')) result = { ready: true }
      else if (chatSelection) result = chatSelectionReadiness()
      else {
        result = await reloadReadinessAfterSaving()
        if (result.ready && transitioning()) result = postponed
      }
    } catch {
      result = { ready: false, reason: 'Your draft could not be saved. Copy it before leaving.' }
    }
    await androidNavigationReady({ ready: result.ready, reason: result.reason, requestId })
  }
  window.addEventListener('athena:prepare-native-navigation', prepare)
  return () => window.removeEventListener('athena:prepare-native-navigation', prepare)
}
