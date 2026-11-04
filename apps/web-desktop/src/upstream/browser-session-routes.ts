import { routePathname, routeSessionId } from '@/app/routes'
import { $selectedStoredSessionId, $sessionResumeRequest, requestSessionResume } from '@/store/session'
import { WEB_CONNECTION_ID } from '../platform/connection'
import { browserSessionRouteProfile } from '../platform/session-route'
import { isBrowserToolRoute } from '../experience/tool-routes'

let dispose: (() => void) | undefined

/** Admit explicit URL owners before the router can infer a session from its id alone. */
export function installBrowserSessionRoutes(): () => void {
  if (dispose) return dispose
  const admit = () => {
    const url = new URL(window.location.href), profile = browserSessionRouteProfile(url)
    if (!profile) return
    const route = url.hash.slice(1)
    if (isBrowserToolRoute(routePathname(route))) return
    let sessionId: string | null
    try { sessionId = routeSessionId(route) } catch { return }
    if (!sessionId) return
    const current = $sessionResumeRequest.get(), selected = $selectedStoredSessionId.get()
    if (current?.sessionId === sessionId && current.ownerRoute?.connectionId === WEB_CONNECTION_ID &&
        current.ownerRoute.profile === profile && (!selected || selected === sessionId)) return
    requestSessionResume(sessionId, { connectionId: WEB_CONNECTION_ID, profile })
  }
  // Capture precedes HashRouter's native history listener. Browser back/forward
  // and hash navigation use the same engine resume command as the initial load.
  window.addEventListener('popstate', admit, true)
  dispose = () => { window.removeEventListener('popstate', admit, true); dispose = undefined }
  admit()
  return dispose
}
