import { useEffect, useSyncExternalStore, type RefObject } from 'react'
import { androidAppSettingsMenu, isAndroidApp } from '../platform/android'
import { Codicon } from '../upstream/browser-api'
import { BrowserToolbarButton } from './ui/toolbar-button'

type SettingsLinkProps = {
  triggerRef: RefObject<HTMLButtonElement | null>
  onOpenRoute: (path: string) => void
  active?: boolean
  className?: string
  row?: boolean
}

export function SettingsLink({ triggerRef, onOpenRoute, active, className, row }: SettingsLinkProps) {
  return <BrowserToolbarButton ref={triggerRef} className={className} tooltip={row ? undefined : "Settings"} aria-label="Settings" aria-current={active ? 'page' : undefined} onClick={() => onOpenRoute('/settings')}>
    <Codicon name="settings-gear" />{row && <span>Settings</span>}
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
