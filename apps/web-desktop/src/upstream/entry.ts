import { prepareBrowserBridge } from './browser-bootstrap'

/** Install the host before evaluating stores that read its desktop compatibility bridge. */
export async function startBrowserHost(): Promise<void> {
  const { installWebBridge } = await import('../web-bridge/install')
  installWebBridge()
  const { observeRendererPreferences } = await import('./preference-sync')
  observeRendererPreferences()
  prepareBrowserBridge()
  await import('./engine-registration')
  const { installBrowserSessionRoutes } = await import('./browser-session-routes')
  const stopSessionRoutes = installBrowserSessionRoutes()
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
  } catch (error) { stopSummaries(); stopNotifications(); stopSessionRoutes(); throw error }
}
