import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { useBrowserSidebarSections } from './sidebar-sections'
import { useBrowserEngine } from './engine'
import { useCompactBrowser, useMobileBrowser } from './ui/use-compact-browser'
import { KANBAN_ROUTE } from './tool-routes'
import { useMobileChatHistory } from './mobile-chat-history'
import { $conversationOpenRequest, $preserveNavigationRequest } from './conversation-navigation'
import { clampNavigationWidth, DEFAULT_NAVIGATION_WIDTH, MAX_NAVIGATION_WIDTH, MIN_NAVIGATION_WIDTH, readNavigationWidth, writeBrowserPreference } from './browser-preferences'

/** Browser navigation preferences and focus never own the conversation state. */
export function useBrowserNavigation({ selectionKey, path, main, trigger, rail, archiveToasts }: {
  selectionKey: string
  path: string
  main: RefObject<HTMLElement | null>
  trigger: RefObject<HTMLButtonElement | null>
  rail: RefObject<HTMLElement | null>
  archiveToasts: RefObject<HTMLDivElement | null>
}) {
  const sections = useBrowserSidebarSections()
  const actionsTrigger = useRef<HTMLButtonElement>(null)
  const drawer = useRef<HTMLElement>(null)
  const compact = useCompactBrowser()
  const { navigation: { coversWorkspace, useSidebar } } = useBrowserEngine()
  const mobile = useMobileBrowser()
  const kanban = path === KANBAN_ROUTE.path
  const [drawerRequested, setDrawerOpen] = useState(mobile)
  const drawerOpen = drawerRequested && !kanban
  const [width, setWidth] = useState(readNavigationWidth)
  const [searchFocusRequest, setSearchFocusRequest] = useState(0)
  const previous = useRef({ selectionKey, path })
  const focusDrawerOnOpen = useRef(false)
  const preserveNextSelection = useRef(false)
  const preserveTimeout = useRef(0)
  const showHistory = () => {
    if (compact) {
      focusDrawerOnOpen.current = true
      setDrawerOpen(true)
    } else sidebar.setOpen(true)
  }
  const dismissDrawer = () => {
    setDrawerOpen(false)
    requestAnimationFrame(() => trigger.current?.focus())
  }
  const toggleDrawer = () => {
    if (drawerOpen) {
      dismissDrawer()
    } else {
      focusDrawerOnOpen.current = true
      setDrawerOpen(true)
    }
  }
  const sidebar = useSidebar({
    compact,
    toggleDrawer,
    focusSearch: () => {
      if (coversWorkspace(path)) return
      if (compact) setDrawerOpen(true)
      setSearchFocusRequest(value => value + 1)
    }
  })
  useEffect(() => {
    if (!compact) return
    return $preserveNavigationRequest.listen(() => {
      preserveNextSelection.current = true
      window.clearTimeout(preserveTimeout.current)
      // Expire the intent if opening a side chat does not change the selection.
      preserveTimeout.current = window.setTimeout(() => { preserveNextSelection.current = false }, 2000)
    })
  }, [compact])
  useEffect(() => () => window.clearTimeout(preserveTimeout.current), [])
  useEffect(() => { setDrawerOpen(mobile) }, [compact, mobile])
  useEffect(() => $conversationOpenRequest.listen(() => {
    if (!drawerOpen) return
    setDrawerOpen(false)
    requestAnimationFrame(() => main.current?.focus())
  }), [drawerOpen, main])
  useEffect(() => {
    if (previous.current.selectionKey !== selectionKey || previous.current.path !== path) {
      if (preserveNextSelection.current) {
        preserveNextSelection.current = false
        window.clearTimeout(preserveTimeout.current)
      } else if (!mobile || (previous.current.path !== path && coversWorkspace(path))) {
        // Startup can restore both a session selection and its route. Keep the
        // mobile chat list visible until an explicit conversation-open request.
        setDrawerOpen(false)
        if (drawerOpen) requestAnimationFrame(() => main.current?.focus())
      }
    }
    previous.current = { selectionKey, path }
  }, [selectionKey, path, mobile])
  useEffect(() => { writeBrowserPreference('navigationWidth', String(width)) }, [width])
  useEffect(() => {
    if (!drawerOpen) { focusDrawerOnOpen.current = false; return }
    if (focusDrawerOnOpen.current) {
      focusDrawerOnOpen.current = false
      drawer.current?.focus({ preventScroll: true })
    }
    const keydown = (event: KeyboardEvent) => {
      // Portaled controls own focus and Escape until they are dismissed.
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[role="menu"], [data-browser-action-surface]'))) return
      if (event.key === 'Escape') dismissDrawer()
      if (event.key !== 'Tab') return
      const items = [
        ...(rail.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
        ...(drawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,[tabindex="0"]') ?? []),
        ...(archiveToasts.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
      ].filter(el => Boolean(el.getClientRects().length))
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === drawer.current)) {
        event.preventDefault()
        const precedingRailButton = document.activeElement === drawer.current ? Array.from(rail.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []).at(-1) : null
        ;(precedingRailButton ?? last)?.focus()
      }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [archiveToasts, drawerOpen, rail])
  useEffect(() => {
    if (searchFocusRequest) drawer.current?.querySelector<HTMLInputElement>('.browser-session-search input')?.focus({ preventScroll: true })
  }, [searchFocusRequest])
  const backToHistory = useMobileChatHistory({
    mobile, drawerOpen, covered: coversWorkspace(path),
    showHistory,
    showConversation: () => {
      setDrawerOpen(false)
      requestAnimationFrame(() => main.current?.focus())
    }
  })
  const open = compact ? drawerOpen : sidebar.open
  return {
    sections, actionsTrigger, drawer, compact, mobile, drawerOpen, width, setWidth, backToHistory, showHistory, searchFocusRequest,
    open,
    toggle: compact ? toggleDrawer : () => sidebar.setOpen(!sidebar.open),
    closeDrawer: () => setDrawerOpen(false),
    dismissDrawer
  }
}

type Navigation = ReturnType<typeof useBrowserNavigation>

export function BrowserNavigationResizer({ navigation }: { navigation: Navigation }) {
  const resize = useRef<{ startX: number; startWidth: number; scale: number } | null>(null)
  const { width, setWidth } = navigation
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    resize.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <div className="browser-navigation-resizer" hidden={!navigation.open} role="separator" tabIndex={0} aria-label="Resize navigation panel" aria-orientation="vertical" aria-valuemin={MIN_NAVIGATION_WIDTH} aria-valuemax={MAX_NAVIGATION_WIDTH} aria-valuenow={Math.round(width)} onPointerDown={event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    const scale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--web-ui-scale')) || 1
    resize.current = { startX: event.clientX, startWidth: width, scale }
    event.currentTarget.setPointerCapture(event.pointerId)
  }} onPointerMove={event => {
    const start = resize.current
    if (start) setWidth(clampNavigationWidth(start.startWidth + (event.clientX - start.startX) / start.scale))
  }} onPointerUp={finish} onPointerCancel={finish} onDoubleClick={() => setWidth(DEFAULT_NAVIGATION_WIDTH)} onKeyDown={event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); setWidth(value => clampNavigationWidth(value - 16)) }
    if (event.key === 'ArrowRight') { event.preventDefault(); setWidth(value => clampNavigationWidth(value + 16)) }
    if (event.key === 'Home') { event.preventDefault(); setWidth(MIN_NAVIGATION_WIDTH) }
    if (event.key === 'End') { event.preventDefault(); setWidth(MAX_NAVIGATION_WIDTH) }
  }} />
}
