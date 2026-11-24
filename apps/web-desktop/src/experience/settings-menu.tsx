import { useEffect, useSyncExternalStore, type RefObject } from 'react'
import { androidAppSettingsMenu, isAndroidApp } from '../platform/android'
import { signOut } from '../platform/sign-out'
import { Codicon } from '../upstream/browser-api'
import { reportActionFailure } from './action-errors'
import { reorderableRailButton } from './app-rail'
import { BrowserToolbarButton } from './ui/toolbar-button'

type SettingsLinkProps = {
  triggerRef: RefObject<HTMLButtonElement | null>
  onOpenRoute: (path: string) => void
  active?: boolean
  reorderable?: boolean
}

export function SettingsLink({ triggerRef, onOpenRoute, active, reorderable }: SettingsLinkProps) {
  return <BrowserToolbarButton {...(reorderable ? reorderableRailButton : {})} ref={triggerRef} tooltip="Settings" aria-label="Settings" aria-current={active ? 'page' : undefined} onClick={() => onOpenRoute('/settings')}>
    <Codicon name="settings-gear" />
  </BrowserToolbarButton>
}

export function SignOutButton({ row = false }: { row?: boolean }) {
  return <BrowserToolbarButton className={row ? 'browser-sidebar-control' : undefined} tooltip={row ? undefined : 'Sign out'}
    aria-label="Sign out" onClick={() => void signOut().catch(error => {
      reportActionFailure(error instanceof Error ? error.message : 'Sign-out failed. Try again.')
    })}>
    <Codicon name="output" />{row && <span>Sign out</span>}
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
