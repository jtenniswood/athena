import { prepareBrowserBridge } from './browser-bootstrap'
import { installBrowserPush } from '../platform/browser-push'
import { resolveToken } from '../platform/connection'

/** Install the host before evaluating stores that read its desktop compatibility bridge. */
export async function startBrowserHost(): Promise<void> {
  // Public host flags must precede evaluation of upstream stores.
  window.__HERMES_AUTH_REQUIRED__ = !resolveToken()
  window.__HERMES_UI_SURFACE__ = 'webapp'
  const { installWebBridge } = await import('../web-bridge/install')
  installWebBridge()
  const { observeRendererPreferences } = await import('./preference-sync')
  observeRendererPreferences()
  prepareBrowserBridge()
  await import('./engine-registration')
  const { installBrowserSessionRoutes } = await import('./browser-session-routes')
  const stopSessionRoutes = installBrowserSessionRoutes()
  const stopBrowserPush = installBrowserPush()
  let stopNotifications = () => {}
  let stopSummaries = () => {}
  try {
    const { installBrowserSessionSummaries } = await import('./session-summaries')
    stopSummaries = installBrowserSessionSummaries()
    const { installBrowserNotificationCommands } = await import('./browser-notifications')
    stopNotifications = installBrowserNotificationCommands()
    const { installBrowserWindowCommands } = await import('./browser-windows')
    installBrowserWindowCommands()
    const { initializeBrowserShell } = await import('./browser-initialize')
    initializeBrowserShell()
    await import('../../../desktop/src/main')
  } catch (error) { stopSummaries(); stopNotifications(); stopBrowserPush(); stopSessionRoutes(); throw error }
}
