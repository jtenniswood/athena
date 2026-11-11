import { useEffect, useRef, useState, type ComponentProps, type ReactNode, type PointerEvent, type RefObject, type MouseEvent } from 'react'
import { useBrowserSidebarSections } from './sidebar-sections'
import { useBrowserEngine } from './engine'
import { Codicon } from '../upstream/browser-api'
import { AppSettingsRegistration, SettingsLink } from './settings-menu'
import { BrowserToolbarButton } from './ui/toolbar-button'
import { useCompactBrowser, useMobileBrowser } from './ui/use-compact-browser'
import { useMobileChatHistory } from './mobile-chat-history'
import { $conversationOpenRequest, $preserveNavigationRequest } from './conversation-navigation'
import { clampNavigationWidth, DEFAULT_NAVIGATION_WIDTH, MAX_NAVIGATION_WIDTH, MIN_NAVIGATION_WIDTH, NAVIGATION_TAB_LABELS, NAVIGATION_TABS, readNavigationTab, readNavigationWidth, readVisibleNavigationTabs, type NavigationTab, writeBrowserPreference } from './browser-preferences'

/** Browser navigation preferences and focus never own the conversation state. */
export function useBrowserNavigation({ selectionKey, path, main, trigger }: {
  selectionKey: string
  path: string
  main: RefObject<HTMLElement | null>
  trigger: RefObject<HTMLButtonElement | null>
}) {
  const sections = useBrowserSidebarSections()
  const actionsTrigger = useRef<HTMLButtonElement>(null)
  const drawer = useRef<HTMLElement>(null)
  const compact = useCompactBrowser()
  const { navigation: { coversWorkspace, useSidebar } } = useBrowserEngine()
  const mobile = useMobileBrowser()
  const [drawerOpen, setDrawerOpen] = useState(mobile)
  const [width, setWidth] = useState(readNavigationWidth)
  const [tab, setTab] = useState<NavigationTab>(readNavigationTab)
  const [visibleTabs, setVisibleTabs] = useState<NavigationTab[]>(readVisibleNavigationTabs)
  const [searchFocusRequest, setSearchFocusRequest] = useState(0)
  const previous = useRef({ selectionKey, path })
  const focusDrawerOnOpen = useRef(false)
  const preserveNextSelection = useRef(false)
  const preserveTimeout = useRef(0)
  const selectSessionsTab = () => {
    setVisibleTabs(current => current.includes('sessions') ? current : ['sessions', ...current])
    setTab('sessions')
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
      selectSessionsTab()
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
  useEffect(() => { writeBrowserPreference('activeTab', tab) }, [tab])
  useEffect(() => { writeBrowserPreference('navigationTabs', JSON.stringify(visibleTabs)) }, [visibleTabs])
  useEffect(() => { if (!visibleTabs.includes(tab)) setTab(visibleTabs[0]) }, [tab, visibleTabs])
  useEffect(() => { writeBrowserPreference('navigationWidth', String(width)) }, [width])
  useEffect(() => {
    if (!drawerOpen) { focusDrawerOnOpen.current = false; return }
    if (focusDrawerOnOpen.current) {
      focusDrawerOnOpen.current = false
      const target = drawer.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
        ?? (mobile ? drawer.current : actionsTrigger.current)
      target?.focus({ preventScroll: true })
    }
    const keydown = (event: KeyboardEvent) => {
      // Portaled controls own focus and Escape until they are dismissed.
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[role="menu"], [data-browser-action-surface]'))) return
      if (event.key === 'Escape') dismissDrawer()
      if (event.key !== 'Tab') return
      const items = Array.from(drawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,[tabindex="0"]') || []).filter(el => Boolean(el.getClientRects().length))
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === drawer.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [drawerOpen, mobile])
  useEffect(() => {
    if (searchFocusRequest) drawer.current?.querySelector<HTMLInputElement>('.browser-session-search input')?.focus({ preventScroll: true })
  }, [searchFocusRequest])
  const backToHistory = useMobileChatHistory({
    mobile, drawerOpen, covered: coversWorkspace(path),
    showHistory: () => {
      selectSessionsTab()
      focusDrawerOnOpen.current = true
      setDrawerOpen(true)
    },
    showConversation: () => {
      setDrawerOpen(false)
      requestAnimationFrame(() => main.current?.focus())
    }
  })
  return {
    sections, actionsTrigger, drawer, compact, mobile, drawerOpen, width, setWidth, tab, setTab, visibleTabs, backToHistory,
    open: compact ? drawerOpen : sidebar.open,
    toggle: compact ? toggleDrawer : () => sidebar.setOpen(!sidebar.open),
    closeDrawer: () => setDrawerOpen(false),
    dismissDrawer,
    toggleTab(value: NavigationTab) {
      setVisibleTabs(current => {
        if (current.includes(value)) return current.length === 1 ? current : current.filter(item => item !== value)
        return [...current, value]
      })
    },
    reorderTabs(source: NavigationTab, target: NavigationTab, after: boolean) {
      setVisibleTabs(current => {
        if (source === target) return current
        const next = current.filter(value => value !== source)
        const targetIndex = next.indexOf(target)
        if (targetIndex < 0) return current
        next.splice(targetIndex + (after ? 1 : 0), 0, source)
        return next
      })
    }
  }
}

type Navigation = ReturnType<typeof useBrowserNavigation>

export function BrowserNavigationTabs({ navigation, actions }: { navigation: Navigation; actions?: ReactNode }) {
  const [draggedTab, setDraggedTab] = useState<NavigationTab | null>(null)
  const { actionsTrigger, tab, setTab, visibleTabs } = navigation
  const showActions = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    actionsTrigger.current?.click()
  }
  if (visibleTabs.length === 1 && !actions && !(navigation.compact && !navigation.mobile)) return null
  return <>
    <div className="browser-navigation-heading">
      {visibleTabs.length > 1 && <div className="browser-navigation-tabs" role="tablist" aria-label="Navigation" onContextMenu={showActions}>
        {visibleTabs.map((value, index) => <button key={value} type="button" role="tab" tabIndex={tab === value ? 0 : -1} aria-selected={tab === value} draggable={visibleTabs.length > 1} data-dragging={draggedTab === value || undefined} onDragStart={event => {
          setDraggedTab(value)
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', value)
        }} onDragOver={event => {
          if (!draggedTab || draggedTab === value) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }} onDrop={event => {
          event.preventDefault()
          const source = draggedTab || NAVIGATION_TABS.find(item => item === event.dataTransfer.getData('text/plain'))
          if (!source) return
          const bounds = event.currentTarget.getBoundingClientRect()
          navigation.reorderTabs(source, value, event.clientX >= bounds.left + bounds.width / 2)
          setDraggedTab(null)
        }} onDragEnd={() => setDraggedTab(null)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? visibleTabs[(index + 1) % visibleTabs.length] : event.key === 'ArrowLeft' ? visibleTabs[(index + visibleTabs.length - 1) % visibleTabs.length] : null
          if (next) {
            event.preventDefault()
            event.stopPropagation()
            setTab(next)
            ;(event.currentTarget.parentElement?.children[visibleTabs.indexOf(next)] as HTMLElement)?.focus()
          }
        }} onClick={() => setTab(value)}>{NAVIGATION_TAB_LABELS[value]}</button>)}
      </div>}
      {actions}
      {navigation.compact && !navigation.mobile && <BrowserToolbarButton tooltip="Close navigation" aria-label="Close navigation" onClick={navigation.dismissDrawer}><Codicon name="close" /></BrowserToolbarButton>}
    </div>
  </>
}

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

export function BrowserNavigationSettings({ navigation, onOpenRoute, row = false }: { navigation: Navigation; onOpenRoute: ComponentProps<typeof SettingsLink>['onOpenRoute']; row?: boolean }) {
  return <>
    <SettingsLink onOpenRoute={onOpenRoute} triggerRef={navigation.actionsTrigger} triggerClassName={row ? "browser-sidebar-footer-row browser-navigation-actions-trigger" : "browser-navigation-actions-trigger"} triggerLabel={row ? "Settings" : undefined} />
    <AppSettingsRegistration />
  </>
}
