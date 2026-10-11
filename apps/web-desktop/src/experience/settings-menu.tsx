import { useEffect, useState, type RefObject } from 'react'
import { Codicon, notifyError } from '../upstream/browser-api'
import { signOut } from '../platform/sign-out'
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
  const [anchor, setAnchor] = useState<BrowserActionAnchor | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  useEffect(() => { if (navigationOpen === false) setAnchor(null) }, [navigationOpen])
  const groups: BrowserActionGroup[] = [
    { key: 'systems', label: 'Systems', actions: [
      { key: 'settings', label: 'Settings', icon: <Codicon name="settings-gear" size="1rem" />, afterClose: true, run: () => onOpenRoute('/settings') },
    ] },
    ...additionalGroups,
    { key: 'account', actions: [{ key: 'sign-out', label: signingOut ? 'Signing out…' : 'Sign out', icon: <Codicon name="sign-out" size="1rem" />, disabled: signingOut, afterClose: true, run: () => {
      setSigningOut(true)
      void signOut().catch(error => notifyError(error, 'Could not sign out')).finally(() => setSigningOut(false))
    } }] }
  ]
  return <>
    <BrowserToolbarButton ref={triggerRef} tooltip={triggerTooltip} className={triggerClassName} aria-label="Navigation tabs" aria-haspopup={compact ? 'dialog' : 'menu'} aria-expanded={Boolean(anchor)} onClick={event => {
      const bounds = event.currentTarget.getBoundingClientRect()
      setAnchor({ x: bounds.right, y: bounds.bottom, returnFocus: event.currentTarget })
    }}><Codicon name="settings-gear" /></BrowserToolbarButton>
    <BrowserActionSurface title="Settings and workspace" className="browser-settings-menu" groups={groups} anchor={anchor} compact={compact} onClose={() => setAnchor(null)} fallbackFocus={triggerRef} />
  </>
}
