import { routePathname, routeSessionId } from '@/app/routes'
import { $gatewaySwitching } from '@/store/gateway-switch'
import { $selectedStoredSessionId, $sessionResumeRequest, requestSessionResume } from '@/store/session'
import { WEB_CONNECTION_ID } from '../platform/connection'
import { browserSessionRouteProfile } from '../platform/session-route'
import { isBrowserToolRoute } from '../experience/tool-routes'

let dispose: (() => void) | undefined

/** Admit explicit URL owners before the router can infer a session from its id alone. */
export function installBrowserSessionRoutes(): () => void {
  if (dispose) return dispose
  const admit = (recovering = false) => {
    const url = new URL(window.location.href), profile = browserSessionRouteProfile(url)
    if (!profile && !recovering) return
    const route = url.hash.slice(1)
    if (isBrowserToolRoute(routePathname(route))) return
    let sessionId: string | null
    try { sessionId = routeSessionId(route) } catch { return }
    if (!sessionId) return
    const current = $sessionResumeRequest.get(), selected = $selectedStoredSessionId.get()
    if (!recovering && current?.sessionId === sessionId && current.ownerRoute?.connectionId === WEB_CONNECTION_ID &&
        current.ownerRoute.profile === profile && (!selected || selected === sessionId)) return
    requestSessionResume(sessionId, profile ? { connectionId: WEB_CONNECTION_ID, profile } : undefined)
  }
  // Cold recovery clears selection without changing the URL. Reissue that
  // intent only if no newer engine request or selection took ownership.
  let resumeBeforeSwitch = $sessionResumeRequest.get()
  const stopSwitch = $gatewaySwitching.listen((switching, previous) => {
    if (switching) { resumeBeforeSwitch = $sessionResumeRequest.get(); return }
    if (previous && !$selectedStoredSessionId.get() && $sessionResumeRequest.get() === resumeBeforeSwitch) admit(true)
  })
  // Capture precedes HashRouter's native history listener. Browser back/forward
  // and hash navigation use the same engine resume command as the initial load.
  const onPopState = () => admit()
  window.addEventListener('popstate', onPopState, true)
  dispose = () => { stopSwitch(); window.removeEventListener('popstate', onPopState, true); dispose = undefined }
  admit()
  return dispose
}
