import { prepareBrowserBridge } from './browser-bootstrap'
import { installSidebarCollapse } from '../web-sidebar-collapse'

/** Install the host before evaluating stores that read its desktop compatibility bridge. */
export async function startBrowserHost(): Promise<void> {
  const { installWebBridge } = await import('../web-bridge/install')
  installWebBridge()
  const { observeRendererPreferences } = await import('./preference-sync')
  observeRendererPreferences()
  prepareBrowserBridge()
  installSidebarCollapse()
  const { initializeBrowserShell } = await import('./browser-initialize')
  initializeBrowserShell()
  await import('../../../desktop/src/main')
}
