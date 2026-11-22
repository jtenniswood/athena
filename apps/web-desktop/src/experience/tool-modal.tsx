import { useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { OverlayView } from '../upstream/browser-api'
import { useBrowserEngine } from './engine'
import { BROWSER_TOOL_ROUTES, KANBAN_ROUTE } from './tool-routes'
import './ui/fullscreen-overlay.css'

/** Tool routes cover the workspace; closing returns to the complete prior URL. */
export function BrowserToolModal({ mobile, chatUrl }: { mobile: boolean; chatUrl: string }) {
  const { surfaces: { Page: BrowserPageSurface } } = useBrowserEngine()
  const location = useLocation(), navigate = useNavigate()
  const fullScreenKanban = mobile && location.pathname === KANBAN_ROUTE.path
  const route = fullScreenKanban ? KANBAN_ROUTE : BROWSER_TOOL_ROUTES.find(item => item.path === location.pathname)
  const previous = useRef('/')
  useLayoutEffect(() => {
    // Settings can launch a tool panel. Return to the underlying workspace so
    // the renderer does not record that tool as Settings' own return target.
    if (!route && location.pathname !== '/settings') previous.current = location.pathname + location.search + location.hash
  }, [location, route])
  if (!route) return null
  const closeLabel = `Close ${route.label}`
  const close = () => { void navigate(fullScreenKanban ? chatUrl : previous.current, { replace: true }) }
  return <OverlayView closeLabel={closeLabel} onClose={close}
    rootClassName={fullScreenKanban ? 'browser-fullscreen-overlay-card' : undefined}
    contentClassName={fullScreenKanban ? 'pt-[calc(var(--titlebar-height)+0.5rem)]' : undefined}>
    <BrowserPageSurface />
  </OverlayView>
}
