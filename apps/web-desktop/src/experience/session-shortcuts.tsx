import { useEffect, useRef } from 'react'
import type { ActionItemSpec } from '@/components/ui/actions-menu'
import { IS_MAC } from '@/lib/keybinds/combo'

const shortcutKeys = { rename: 'r', pin: 'p', unread: 'u', files: 'e', review: 'g', archive: 'a', delete: 'backspace' } as const
type SessionAction = keyof typeof shortcutKeys
type ShortcutActions = Partial<Record<SessionAction, Pick<ActionItemSpec, 'disabled' | 'onSelect'>>>

export function browserSessionActionLabel(action: SessionAction, label: string) {
  const key = action === 'delete' ? (IS_MAC ? '⌫' : 'Backspace') : shortcutKeys[action].toUpperCase()
  const hint = IS_MAC ? `⇧⌘${key}` : `Ctrl+Shift+${key}`
  return <><span>{label}</span><span className="browser-session-shortcut" aria-hidden="true">{hint}</span></>
}

/** Only the chat toolbar owns global shortcuts; row menus share its labels and actions. */
export function useBrowserSessionShortcuts(enabled: boolean, actions: ShortcutActions) {
  const latest = useRef(actions)
  latest.current = actions
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || !event.shiftKey) return
      if (IS_MAC ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return
      const action = (Object.keys(shortcutKeys) as SessionAction[]).find(action => shortcutKeys[action] === event.key.toLowerCase())
      if (!action) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable], [role="textbox"]'))) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [data-browser-action-surface]')) return
      const item = latest.current[action]
      if (!item || item.disabled) return
      event.preventDefault()
      event.stopImmediatePropagation()
      item.onSelect(event)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [enabled])
}
