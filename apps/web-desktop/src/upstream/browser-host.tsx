import { AndroidSharePicker } from './android-share'
import { useEffect, type ReactNode } from 'react'
import { BrowserLinkContextMenu } from '../experience/link-context-menu'
import { ContribWiring, WiredPane } from '@/app/contrib/wiring'
import { createPluginContext } from '@/contrib/plugin'
import { host } from '@hermes/plugin-sdk'
import { startFaceClock, stopFaceClock } from '@/plugins/hermes-bots/avatar'
import { migrateBotMeta, primeRoster } from '@/plugins/hermes-bots/data'
import { BOTS_LOCALES } from '@/plugins/hermes-bots/i18n'
import { ID, setPluginCtx } from '@/plugins/hermes-bots/shared'
import { useContributions } from '@/contrib/react/use-contributions'
import { navigateToWorkspacePage } from '@/app/routes'
import { SessionTileCloseConfirm } from '@/app/chat/session-tile'
import { browserPaneComposition } from '../experience/browser-pane-composition'
import type { BrowserHostPanel } from '../experience/contracts/host'
import type { BrowserNavigate } from '../experience/contracts/selection'
import { BrowserWorkspace } from './browser-workspace'
import { BrowserPageRoutes } from './browser-routes'
import { useBrowserSettings } from './settings'

/** Mount engine contributions once; Athena supplies the product shell. */
export function BrowserEngineHost({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Reuse the existing profile appearance storage, translations, and avatar
    // rendering without registering the Bot Mode workspace or messaging hooks.
    const context = createPluginContext(ID)
    setPluginCtx(context)
    const disposeLocales = context.i18n.register(BOTS_LOCALES)
    startFaceClock()
    void migrateBotMeta(context.storage).catch(() => undefined)
    const unsubscribe = host.state.gateway.subscribe(state => {
      if (state === 'open') void primeRoster()
    })
    return () => {
      unsubscribe()
      stopFaceClock()
      disposeLocales()
      setPluginCtx(null)
    }
  }, [])
  return <ContribWiring>{children}<AndroidSharePicker /><BrowserLinkContextMenu /><SessionTileCloseConfirm /></ContribWiring>
}

export function BrowserSessionsSurface() { return <WiredPane part="sidebar" /> }
export function BrowserStatusSurface() { return <WiredPane part="statusbar" /> }
export function BrowserPageSurface() {
  return <BrowserPageRoutes><WiredPane part="chatRoutes" /></BrowserPageRoutes>
}

export function BrowserConversationSurface() {
  const { workspacePanelIds } = browserPaneComposition(useContributions('panes'))
  return <BrowserWorkspace panelIds={workspacePanelIds} />
}

/** Project pane commands without exposing renderer contribution objects. */
export function useBrowserHostPanels(): readonly BrowserHostPanel[] {
  const { toolbarPanes } = browserPaneComposition(useContributions('panes'))
  const { panels } = useBrowserSettings(toolbarPanes.map(pane => ({
    id: pane.id,
    collapsible: Boolean((pane.data as { collapsible?: boolean } | undefined)?.collapsible)
  })))
  return panels.map(panel => {
    const title = String(toolbarPanes.find(pane => pane.id === panel.id)?.title || panel.id).replaceAll('-', ' ').trim()
    return { ...panel, label: title ? title[0].toUpperCase() + title.slice(1) : panel.id }
  })
}

export function openBrowserPage(navigate: BrowserNavigate, path: string): void {
  navigateToWorkspacePage(navigate, path)
}
