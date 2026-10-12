import { Codicon, useContributions } from '../upstream/browser-api'
import type { MenuKit } from '../upstream/browser-api'
import { useBrowserSettings } from '../upstream/settings'
import { browserSessionActionLabel, useBrowserSessionShortcuts } from './session-shortcuts'

type PanelEntry = {
  id: string
  title?: unknown
  data?: unknown
}

function useChatPanels(entries: readonly PanelEntry[] = []) {
  const panes = useContributions('panes')
  const panelPanes = entries.filter(entry => panes.some(pane => pane.id === entry.id))
  const model = useBrowserSettings(panelPanes.map(pane => ({
    id: pane.id,
    collapsible: Boolean((pane.data as { collapsible?: boolean } | undefined)?.collapsible)
  })))
  return { panelPanes, panels: model.panels }
}

export function useBrowserChatPanelShortcuts(enabled: boolean, entries: readonly PanelEntry[], onOpen: () => void) {
  const { panels } = useChatPanels(entries)
  const action = (id: string) => ({
    disabled: !panels.some(panel => panel.id === id),
    onSelect: () => { if (panels.find(panel => panel.id === id)?.select('toggle')) onOpen() }
  })
  useBrowserSessionShortcuts(enabled, { files: action('files'), review: action('review') })
}

export function BrowserChatPanelActions({ kit, entries, onOpen }: {
  kit: MenuKit
  entries?: readonly PanelEntry[]
  onOpen?: () => void
}) {
  const { panelPanes, panels } = useChatPanels(entries)

  if (!panelPanes.length) return null
  return <>
    {panels.map(panel => {
      const title = String(panelPanes.find(pane => pane.id === panel.id)?.title || panel.id)
      const label = sentenceCase(title)
      return <kit.Item key={panel.id} aria-checked={panel.checked} onSelect={() => {
        if (panel.select()) onOpen?.()
      }}>
        <Codicon name={panel.id === 'review' ? 'git-compare' : 'files'} size="0.875rem" />
        {panel.id === 'files' || panel.id === 'review' ? browserSessionActionLabel(panel.id, label) : <span>{label}</span>}
      </kit.Item>
    })}
  </>
}

function sentenceCase(label: string) {
  const value = label.replaceAll('-', ' ').trim()
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}
