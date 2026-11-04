import { announceWebappWindow, createBrowserWindowOpener, sessionWindowTarget } from '@/lib/browser-window'
import { $activeGatewayProfile } from '@/store/profile'
import { apiFetch, WEB_CONNECTION_ID } from '../platform/connection'
import { isAndroidApp } from '../platform/android'

/** Engine-dependent window helpers load only after bridge and store registration. */
export function installBrowserWindowCommands(): void {
  if (!window.__HERMES_WEB_BRIDGE__ || isAndroidApp() || typeof BroadcastChannel !== 'function') return
  const bridge = window.hermesDesktop
  const open = createBrowserWindowOpener({
    api: apiFetch,
    basePath: new URL('.', window.location.href).pathname.replace(/\/$/, ''),
    // Athena owns sign-in and connection credentials; same-origin tabs share
    // that owner. Only the upstream readiness handshake is needed here.
    privateSession: false
  })
  const profileFor = (route?: { connectionId?: string | null; profile?: string | null }) => {
    if (route?.connectionId && route.connectionId !== WEB_CONNECTION_ID) {
      throw new Error('This app can only open windows on its configured gateway.')
    }
    return route?.profile?.trim() || $activeGatewayProfile.get()
  }
  bridge.openSessionWindow = async (sessionId, options) => {
    const target = sessionWindowTarget(window.location.href, sessionId, {
      profile: profileFor(options), watch: options?.watch
    })
    return target ? open(target) : { ok: false, error: 'invalid_session_id' }
  }
  bridge.openWindow = async route => {
    const target = new URL(window.location.href)
    target.searchParams.set('profile', profileFor(route))
    target.searchParams.delete('win')
    target.searchParams.delete('watch')
    target.hash = '/'
    return open(target)
  }
  announceWebappWindow()
}
