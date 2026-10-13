import type { ReactNode } from 'react'
import { ContribWiring, WiredPane } from '@/app/contrib/wiring'
import { ContribBoundary, ContribRender } from '@/contrib/react/boundary'
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
  return <ContribWiring>{children}<SessionTileCloseConfirm /></ContribWiring>
}

export function BrowserSessionsSurface() { return <WiredPane part="sidebar" /> }
export function BrowserStatusSurface() { return <WiredPane part="statusbar" /> }
export function BrowserPageSurface() {
  return <BrowserPageRoutes><WiredPane part="chatRoutes" /></BrowserPageRoutes>
}

export function BrowserBotsSurface({ fallback }: { fallback: ReactNode }) {
  const { bots } = browserPaneComposition(useContributions('panes'))
  return bots?.render ? <ContribBoundary id={bots.id}><ContribRender render={bots.render} /></ContribBoundary> : fallback
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
