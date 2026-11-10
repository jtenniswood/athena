import { useStore } from '@nanostores/react'
import { useEffect, useEffectEvent } from 'react'
import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { $sidebarOpen, CHAT_SIDEBAR_PANE_ID, SESSION_SEARCH_FOCUS_EVENT } from '@/store/layout'
import { setPaneOpen } from '@/store/panes'
import type { BrowserSidebarCommands } from '../experience/contracts/host'

/** Connect the renderer's rebindable shortcuts to Athena's sidebar and drawer. */
export function useBrowserSidebarCommands({ compact, toggleDrawer, focusSearch }: BrowserSidebarCommands) {
  const open = useStore($sidebarOpen)
  const toggle = useEffectEvent(toggleDrawer)
  const search = useEffectEvent(focusSearch)
  useEffect(() => {
    const onReveal = (event: Event) => {
      const { id, mode } = (event as CustomEvent<{ id: string; mode: string }>).detail
      if (compact && id === CHAT_SIDEBAR_PANE_ID && mode === 'toggle') toggle()
    }
    const onSearch = () => search()
    // The renderer's docked breakpoint is narrower than Athena's. In the gap,
    // a docked toggle still needs to toggle the drawer rather than the sidebar.
    const stopDocked = compact ? $sidebarOpen.listen(() => toggle()) : undefined
    window.addEventListener(PANE_TOGGLE_REVEAL_EVENT, onReveal)
    window.addEventListener(SESSION_SEARCH_FOCUS_EVENT, onSearch)
    return () => {
      stopDocked?.()
      window.removeEventListener(PANE_TOGGLE_REVEAL_EVENT, onReveal)
      window.removeEventListener(SESSION_SEARCH_FOCUS_EVENT, onSearch)
    }
  }, [compact])
  return { open, setOpen: setBrowserSidebarOpen }
}

function setBrowserSidebarOpen(open: boolean) {
  setPaneOpen(CHAT_SIDEBAR_PANE_ID, open)
}
