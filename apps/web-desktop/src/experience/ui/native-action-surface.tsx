import { useEffect, useRef, useState, type RefObject } from 'react'
import { androidDismissActionMenu, androidHost, androidOpenActionMenu, androidUpdateActionMenu, isAndroidApp, type AndroidMenuGroup, type AndroidActionMenu } from '../../platform/android'
import type { BrowserAction, BrowserActionAnchor, BrowserActionGroup } from './action-surface'
import { restoreBrowserControlFocus } from './dialog-focus'

/** Detect once per surface. Older APKs and ordinary browsers keep Radix menus. */
export function useNativeActionMenus(persistent = false): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(() => isAndroidApp() ? null : false)
  const [live, setLive] = useState(false)
  useEffect(() => {
    if (!isAndroidApp()) return
    let active = true
    void androidHost().then(host => { if (active) {
      setSupported(Boolean(host?.capabilities.includes('action-menu')))
      setLive(Boolean(host?.capabilities.includes('action-menu-live')))
    } })
    return () => { active = false }
  }, [])
  return supported === null ? null : supported && (!persistent || live)
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
  const request = useRef<AndroidActionMenu | null>(null)
  const updateCurrent = useRef<(() => void) | null>(null)
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
          keepOpen: action.keepOpen,
          children: action.children ? serialize(action.children, key, disabled) : undefined }
      }) }))
    }
    const menu = { id, title, compact: true, x: anchor.x, y: anchor.y, viewportWidth: window.innerWidth, groups: serialize(latest.current.groups) }
    request.current = menu
    const select = (selectedId: string, keepOpen: boolean) => {
      if (!active) return
      // Look up only commands still owned by this mounted surface.
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
      const action = callbacks.get(selectedId)
      const current = live.get(selectedId)
      const allowed = action && current && !action.disabled && !current.disabled && !action.children && !current.children
      if (keepOpen) {
        if (allowed && current.keepOpen) current.run()
        return
      }
      latest.current.onClose()
      restoreBrowserControlFocus(anchor.returnFocus, fallbackFocus?.current)
      if (allowed) queueMicrotask(current.run)
    }
    void androidOpenActionMenu(menu, selectedId => select(selectedId, true)).then(result => {
      if (!active) return
      if (result.status === 'unavailable') { latest.current.onUnavailable(); return }
      select(result.status === 'selected' ? result.id : '', false)
    })
    const update = () => {
      callbacks.clear()
      menu.groups = serialize(latest.current.groups)
      void androidHost().then(host => {
        if (active && host?.capabilities.includes('action-menu-live')) {
          void androidUpdateActionMenu(menu).then(ok => { if (active && !ok) latest.current.onUnavailable() })
        }
      })
    }
    updateCurrent.current = update
    return () => { active = false; request.current = null; updateCurrent.current = null; void androidDismissActionMenu(id) }
  }, [anchor, compact, fallbackFocus, title])
  useEffect(() => { if (request.current) updateCurrent.current?.() }, [groups])
  return null
}
