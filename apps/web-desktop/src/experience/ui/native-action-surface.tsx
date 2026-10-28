import { useEffect, useRef, useState, type RefObject } from 'react'
import { androidDismissActionMenu, androidHost, androidOpenActionMenu, isAndroidApp, type AndroidMenuGroup } from '../../platform/android'
import type { BrowserAction, BrowserActionAnchor, BrowserActionGroup } from './action-surface'
import { restoreBrowserControlFocus } from './dialog-focus'

/** Detect once per surface. Older APKs and ordinary browsers keep Radix menus. */
export function useNativeActionMenus(): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(() => isAndroidApp() ? null : false)
  useEffect(() => {
    if (!isAndroidApp()) return
    let active = true
    void androidHost().then(host => { if (active) setSupported(Boolean(host?.capabilities.includes('action-menu'))) })
    return () => { active = false }
  }, [])
  return supported
}

let nextMenuId = 0

export function NativeActionSurface({ title, groups, anchor, compact, onClose, fallbackFocus, onUnavailable }: {
  title: string
  groups: BrowserActionGroup[]
  anchor: BrowserActionAnchor
  compact: boolean
  onClose(): void
  fallbackFocus?: RefObject<HTMLElement | null>
  onUnavailable(): void
}) {
  const latest = useRef({ groups, onClose, onUnavailable })
  latest.current = { groups, onClose, onUnavailable }
  const [iteration, setIteration] = useState(0)
  useEffect(() => {
    let active = true
    const id = `actions-${++nextMenuId}`
    const callbacks = new Map<string, BrowserAction>()
    function serialize(sections: BrowserActionGroup[], parent = '', parentDisabled = false): AndroidMenuGroup[] {
      return sections.map(group => ({ label: group.label, selection: group.selection, items: group.actions.map(action => {
        const key = `${parent}/${encodeURIComponent(group.key)}/${encodeURIComponent(action.key)}`
        const disabled = parentDisabled || action.disabled
        callbacks.set(key, { ...action, disabled })
        return { id: key, label: action.label, description: action.description, disabled,
          destructive: action.destructive, checked: action.checked,
          children: action.children ? serialize(action.children, key, disabled) : undefined }
      }) }))
    }
    const sections = serialize(latest.current.groups)
    void androidOpenActionMenu({ id, title, compact, x: anchor.x, y: anchor.y, viewportWidth: window.innerWidth, groups: sections }).then(result => {
      if (!active) return
      if (result.status === 'unavailable') { latest.current.onUnavailable(); return }
      const action = result.status === 'selected' ? callbacks.get(result.id) : undefined
      // An open native menu is a snapshot. Never execute an invented, disabled,
      // submenu-only, or removed command returned after its web owner changes.
      const live = new Map<string, BrowserAction>()
      function collect(items: BrowserActionGroup[], parent = '', parentDisabled = false) {
        for (const group of items) for (const item of group.actions) {
          const key = `${parent}/${encodeURIComponent(group.key)}/${encodeURIComponent(item.key)}`
          const disabled = parentDisabled || item.disabled
          live.set(key, { ...item, disabled })
          if (item.children) collect(item.children, key, disabled)
        }
      }
      collect(latest.current.groups)
      const current = result.status === 'selected' ? live.get(result.id) : undefined
      const allowed = action && current && !action.disabled && !current.disabled && !action.children && !current.children
      if (allowed && action.keepOpen) {
        action.run()
        setIteration(value => value + 1)
        return
      }
      latest.current.onClose()
      restoreBrowserControlFocus(anchor.returnFocus, fallbackFocus?.current)
      // Native dismissal has already completed. Mount confirmations afterwards.
      if (allowed) queueMicrotask(action.run)
    })
    return () => { active = false; void androidDismissActionMenu(id) }
  }, [anchor, compact, fallbackFocus, iteration, title])
  return null
}
