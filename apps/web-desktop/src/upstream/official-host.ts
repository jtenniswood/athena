import { installBrowserDesktopBridge } from '@/lib/browser-desktop-bridge'
import { installBrowserViewport } from '@/lib/browser-viewport'
import { browserDefaultProfile } from '../platform/browser-default-profile'
import { androidPushGatewayUrl, resumeAndroidPush, stopAndroidPush } from '../platform/android-push'
import { androidOpenSignIn, isAndroidApp } from '../platform/android'
import { assertSafeConnectionChange, beginOperation, setActiveWork } from '../platform/reload-safety'
import { openBrowserExternalLink } from './external-links'
import { webNotify } from '../platform/notifications'
import type { GatewayWsUrlResult } from '@hermes/shared'
import { notifyError } from '@/store/notifications'

/** Extend the released bridge only with Athena's browser and Android experience. */
export function installOfficialBrowserHost(): void {
  if (!installBrowserDesktopBridge()) throw new Error('The official Hermes Webapp host did not initialise.')
  installBrowserViewport()
  window.__HERMES_WEB_BRIDGE__ = true
  const bridge = window.hermesDesktop
  bridge.setActiveWork = setActiveWork
  Object.assign(bridge.profile, {
    getDefault: browserDefaultProfile.getDefault,
    setDefault: browserDefaultProfile.setDefault,
    onDefaultChanged: browserDefaultProfile.onDefaultChanged
  })
  bridge.openExternal = openBrowserExternalLink
  bridge.notify = payload => webNotify(payload)
  const api = bridge.api.bind(bridge)
  bridge.api = async request => {
    const finish = (request.method || 'GET') === 'GET' ? () => {} : beginOperation()
    try { return await api(request) } finally { finish() }
  }
  const selectPaths = bridge.selectPaths.bind(bridge)
  bridge.selectPaths = async options => {
    const finish = beginOperation()
    try { return await selectPaths(options) } finally { finish() }
  }
  const stageFile = bridge.stageFileForAttach?.bind(bridge)
  if (stageFile) bridge.stageFileForAttach = async file => {
    const finish = beginOperation()
    try { return await stageFile(file) } finally { finish() }
  }
  const gatewayUrl = bridge.getGatewayWsUrl.bind(bridge)
  const routedGatewayUrl = bridge.getGatewayWsUrlFor?.bind(bridge)
  const withPush = async (result: GatewayWsUrlResult): Promise<GatewayWsUrlResult> => {
    if (typeof result === 'string') return androidPushGatewayUrl(result)
    if ('wsUrl' in result) return { ...result, wsUrl: await androidPushGatewayUrl(result.wsUrl) }
    return result
  }
  bridge.getGatewayWsUrl = async profile => withPush(await gatewayUrl(profile))
  if (routedGatewayUrl) bridge.getGatewayWsUrlFor = async route => withPush(await routedGatewayUrl(route))
  const logout = bridge.oauthLogoutConnectionConfig.bind(bridge)
  let loggingOut = false
  let signingIn = false
  window.addEventListener('hermes:browser-reauth-required', event => {
    event.preventDefault()
    if (loggingOut || signingIn) return
    const value = (event as CustomEvent<{ loginUrl?: string }>).detail?.loginUrl
    if (!value) return
    const url = new URL(value, window.location.origin)
    if (url.origin !== window.location.origin) return
    signingIn = true
    void (async () => {
      try {
        await assertSafeConnectionChange()
        if (isAndroidApp() && await androidOpenSignIn(url.pathname + url.search)) window.location.reload()
        else if (!isAndroidApp()) window.location.assign(url.href)
      } catch (error) { notifyError(error, 'Sign-in could not continue.') }
      finally { signingIn = false }
    })()
  })
  bridge.oauthLogoutConnectionConfig = async url => {
    await assertSafeConnectionChange()
    await stopAndroidPush()
    loggingOut = true
    try { return await logout(url) }
    catch (error) { await resumeAndroidPush(); throw error }
    finally { loggingOut = false }
  }
  if (isAndroidApp()) {
    delete (bridge as Partial<typeof bridge>).openWindow
    delete (bridge as Partial<typeof bridge>).openSessionWindow
    void resumeAndroidPush()
  }
}
