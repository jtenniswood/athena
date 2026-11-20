import { useEffect, useRef } from 'react'
import { comboFromEvent, formatCombo } from '../upstream/browser-api'

const archivedShortcut = 'mod+alt+a'

export function browserArchivedLabel(label: string) {
  return <><span>{label}</span><span className="browser-session-shortcut" aria-hidden="true">{formatCombo(archivedShortcut)}</span></>
}

export function useBrowserArchivedShortcut(toggleArchived: () => void) {
  const latest = useRef(toggleArchived)
  latest.current = toggleArchived
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || comboFromEvent(event) !== archivedShortcut) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable], [role="textbox"]'))) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [data-browser-action-surface]')) return
      event.preventDefault()
      event.stopImmediatePropagation()
      latest.current()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
