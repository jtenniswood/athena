import { useEffect, useState, type RefObject } from 'react'
import { androidAppSettingsMenu, androidOpenAppSettings, isAndroidApp } from '../platform/android'
import { Codicon } from '../upstream/browser-api'
import { BrowserActionSurface, type BrowserActionAnchor, type BrowserActionGroup } from './ui/action-surface'
import { BrowserToolbarButton } from './ui/toolbar-button'
import { useMobileBrowser } from './ui/use-compact-browser'

type SettingsMenuProps = {
  triggerRef: RefObject<HTMLButtonElement | null>
  onOpenRoute: (path: string) => void
  additionalGroups?: BrowserActionGroup[]
  triggerClassName?: string
  triggerTooltip?: string
  navigationOpen?: boolean
}

export function SettingsMenu({ triggerRef, onOpenRoute, additionalGroups = [], triggerClassName, triggerTooltip = 'Settings', navigationOpen }: SettingsMenuProps) {
  const compact = useMobileBrowser()
  const [appSettingsAvailable, setAppSettingsAvailable] = useState(false)
  useEffect(() => {
    if (!isAndroidApp()) return
    let mounted = true
    void androidAppSettingsMenu(true).then(available => { if (mounted) setAppSettingsAvailable(available) })
    return () => { mounted = false; void androidAppSettingsMenu(false) }
  }, [])
  useEffect(() => {
    if (!appSettingsAvailable) return
    let mounted = true
    void androidAppSettingsMenu(true, true).then(available => {
      if (mounted && !available) setAppSettingsAvailable(false)
    })
    return () => { mounted = false }
  }, [appSettingsAvailable])
  const [anchor, setAnchor] = useState<BrowserActionAnchor | null>(null)
  useEffect(() => { if (navigationOpen === false) setAnchor(null) }, [navigationOpen])
  const groups: BrowserActionGroup[] = [
    ...additionalGroups,
    { key: 'systems', label: 'Systems', actions: [
      { key: 'settings', label: 'Settings', icon: <Codicon name="settings-gear" size="1rem" />, afterClose: true, run: () => onOpenRoute('/settings') },
      ...(appSettingsAvailable ? [{ key: 'app-settings', label: 'App settings', icon: <Codicon name="device-mobile" size="1rem" />, afterClose: true, run: () => { void androidOpenAppSettings() } }] : []),
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
