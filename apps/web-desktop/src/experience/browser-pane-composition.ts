export interface BrowserPaneContribution {
  id: string
  data?: unknown
}

const CHROME_OWNED_PANES = new Set(['workspace', 'sessions', 'hermes-bots:pane', 'terminal'])

/** Keep sidebar actions and upstream workspace projection on one pane policy. */
export function browserPaneComposition<T extends BrowserPaneContribution>(panes: readonly T[]) {
  const bots = panes.find(pane => pane.id === 'hermes-bots:pane')
  const toolbarPanes = panes.filter(pane => !CHROME_OWNED_PANES.has(pane.id))
  const workspacePanelIds = new Set(toolbarPanes.filter(pane =>
    (pane.data as { placement?: string } | undefined)?.placement !== 'main'
  ).map(pane => pane.id))
  return { bots, toolbarPanes, workspacePanelIds }
}
