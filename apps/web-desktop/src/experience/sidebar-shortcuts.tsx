import { useEffect, useRef } from 'react'
import { comboFromEvent, formatCombo } from '../upstream/browser-api'

const shortcuts = { archived: 'mod+alt+a', read: 'mod+alt+r' } as const
type SidebarAction = keyof typeof shortcuts
type SidebarActions = Record<SidebarAction, { disabled?: boolean; run: () => void }>

export function browserSidebarActionLabel(action: SidebarAction, label: string) {
  return <><span>{label}</span><span className="browser-session-shortcut" aria-hidden="true">{formatCombo(shortcuts[action])}</span></>
}

/** Reuse the filter menu's actions and disabled state without changing chat selection. */
export function useBrowserSidebarShortcuts(actions: SidebarActions) {
  const latest = useRef(actions)
  latest.current = actions
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return
      const combo = comboFromEvent(event)
      const action = (Object.keys(shortcuts) as SidebarAction[]).find(action => shortcuts[action] === combo)
      if (!action) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable], [role="textbox"]'))) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [data-browser-action-surface]')) return
      const item = latest.current[action]
      if (item.disabled) return
      event.preventDefault()
      event.stopImmediatePropagation()
      item.run()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
