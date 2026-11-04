import { useEffect, useState, type RefObject } from 'react'
import { androidAppSettingsMenu, androidOpenAppSettings, isAndroidApp } from '../platform/android'
import { Codicon } from '../upstream/browser-api'
import { BrowserToolbarButton } from './ui/toolbar-button'

type SettingsLinkProps = {
  triggerRef: RefObject<HTMLButtonElement | null>
  onOpenRoute: (path: string) => void
  triggerClassName?: string
  triggerLabel?: string
  triggerTooltip?: string
}

export function SettingsLink({ triggerRef, onOpenRoute, triggerClassName, triggerLabel, triggerTooltip = triggerLabel ? undefined : 'Settings' }: SettingsLinkProps) {
  return <BrowserToolbarButton ref={triggerRef} tooltip={triggerTooltip} className={triggerClassName} aria-label="Settings" onClick={() => onOpenRoute('/settings')}>
    <Codicon name="settings-gear" />{triggerLabel && <span>{triggerLabel}</span>}
  </BrowserToolbarButton>
}

export function AppSettingsLink() {
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
  if (!appSettingsAvailable) return null
  return <BrowserToolbarButton tooltip="App settings" className="browser-navigation-settings-link" aria-label="App" onClick={() => { void androidOpenAppSettings() }}>
    <Codicon name="device-mobile" /><span>App</span>
  </BrowserToolbarButton>
}
