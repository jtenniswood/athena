import { useEffect, useState, type RefObject } from 'react'
import { Codicon } from '../upstream/browser-api'
import { useBrowserSettings } from '../upstream/settings'
import { BrowserActionSurface, type BrowserActionAnchor, type BrowserActionGroup } from './ui/action-surface'
import { BrowserToolbarButton } from './ui/toolbar-button'
import { useMobileBrowser } from './ui/use-compact-browser'

type PanelEntry = {
  id: string
  title?: unknown
  data?: unknown
}

type SettingsMenuProps = {
  triggerRef: RefObject<HTMLButtonElement | null>
  onOpenPanel: () => void
  onOpenRoute: (path: string) => void
  panelPanes: PanelEntry[]
  additionalGroups?: BrowserActionGroup[]
  triggerClassName?: string
  triggerTooltip?: string
  navigationOpen?: boolean
}

export function SettingsMenu({ triggerRef, onOpenPanel, onOpenRoute, panelPanes, additionalGroups = [], triggerClassName, triggerTooltip = 'Settings', navigationOpen }: SettingsMenuProps) {
  const compact = useMobileBrowser()
  const [anchor, setAnchor] = useState<BrowserActionAnchor | null>(null)
  useEffect(() => { if (navigationOpen === false) setAnchor(null) }, [navigationOpen])
  const model = useBrowserSettings(panelPanes.map(pane => ({ id: pane.id, collapsible: Boolean((pane.data as { collapsible?: boolean } | undefined)?.collapsible) })))
  const groups: BrowserActionGroup[] = [
    { key: 'panels', label: 'Panels', actions: model.panels.map(panel => {
      const title = String(panelPanes.find(pane => pane.id === panel.id)?.title || panel.id)
      return { key: panel.id, label: sentenceCase(title), ariaLabel: title, checked: panel.checked, icon: <Codicon name={panel.id === 'review' ? 'git-compare' : 'files'} size="1rem" />, afterClose: true, run: () => { if (panel.select()) onOpenPanel() } }
    }) },
    ...additionalGroups,
    { key: 'systems', label: 'Systems', actions: [
      { key: 'settings', label: 'Settings', icon: <Codicon name="settings-gear" size="1rem" />, afterClose: true, run: () => onOpenRoute('/settings') },
    ] }
  ]
  return <>
    <BrowserToolbarButton ref={triggerRef} tooltip={triggerTooltip} className={triggerClassName} aria-label="Navigation tabs" aria-haspopup={compact ? 'dialog' : 'menu'} aria-expanded={Boolean(anchor)} onClick={event => {
      const bounds = event.currentTarget.getBoundingClientRect()
      setAnchor({ x: bounds.right, y: bounds.bottom, returnFocus: event.currentTarget })
    }}><Codicon name="settings-gear" /></BrowserToolbarButton>
    <BrowserActionSurface title="Settings and workspace" className="browser-settings-menu" groups={groups} anchor={anchor} compact={compact} onClose={() => setAnchor(null)} fallbackFocus={triggerRef} />
  </>
}

function sentenceCase(label: string) {
  const value = label.replaceAll('-', ' ').trim()
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}
