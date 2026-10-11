import { Codicon, useContributions } from '../upstream/browser-api'
import type { MenuKit } from '../upstream/browser-api'
import { useBrowserSettings } from '../upstream/settings'

type PanelEntry = {
  id: string
  title?: unknown
  data?: unknown
}

export function BrowserChatPanelActions({ kit, entries, onOpen }: {
  kit: MenuKit
  entries?: readonly PanelEntry[]
  onOpen?: () => void
}) {
  const panes = useContributions('panes')
  const panelPanes = (entries ?? []).filter(entry => panes.some(pane => pane.id === entry.id))
  const model = useBrowserSettings(panelPanes.map(pane => ({
    id: pane.id,
    collapsible: Boolean((pane.data as { collapsible?: boolean } | undefined)?.collapsible)
  })))

  if (!panelPanes.length) return null
  return <>
    <kit.Separator />
    <kit.Label>Panels</kit.Label>
    {model.panels.map(panel => {
      const title = String(panelPanes.find(pane => pane.id === panel.id)?.title || panel.id)
      const label = sentenceCase(title)
      return <kit.Item key={panel.id} aria-checked={panel.checked} onSelect={() => {
        if (panel.select()) onOpen?.()
      }}>
        <Codicon name={panel.id === 'review' ? 'git-compare' : 'files'} size="0.875rem" />
        <span>{label}</span>
      </kit.Item>
    })}
  </>
}

function sentenceCase(label: string) {
  const value = label.replaceAll('-', ' ').trim()
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}
