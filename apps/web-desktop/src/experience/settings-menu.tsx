import { useEffect, useSyncExternalStore, type RefObject } from 'react'
import { androidAppSettingsMenu, isAndroidApp } from '../platform/android'
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

let appSettingsAvailable = false
const availabilityListeners = new Set<() => void>()
function publishAvailability(available: boolean) {
  appSettingsAvailable = available
  availabilityListeners.forEach(listener => listener())
}

export function useAppSettingsAvailable() {
  return useSyncExternalStore(listener => {
    availabilityListeners.add(listener)
    return () => { availabilityListeners.delete(listener) }
  }, () => appSettingsAvailable, () => false)
}

/** The Settings entry is mounted before the native toolbar hands over navigation. */
export function AppSettingsRegistration() {
  useEffect(() => {
    if (!isAndroidApp()) return
    let mounted = true
    void androidAppSettingsMenu(true).then(async available => {
      if (!mounted || !available) return
      const ready = await androidAppSettingsMenu(true, true)
      if (mounted) publishAvailability(ready)
    })
    return () => {
      mounted = false
      publishAvailability(false)
      void androidAppSettingsMenu(false)
    }
  }, [])
  return null
}
