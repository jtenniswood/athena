import { useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { OverlayView } from '../upstream/browser-api'
import { useBrowserEngine } from './engine'
import { SettingsFrameSurface } from './settings/frame-behavior'
import { BROWSER_PAGE_ROUTES, KANBAN_ROUTE, USAGE_ROUTE } from './tool-routes'

/** Tool routes cover the workspace; closing returns to the complete prior URL. */
export function BrowserToolModal() {
  const { surfaces: { Page: BrowserPageSurface } } = useBrowserEngine()
  const location = useLocation(), navigate = useNavigate()
  const route = BROWSER_PAGE_ROUTES.find(item => item.path === location.pathname)
  const previous = useRef('/')
  useLayoutEffect(() => {
    // Settings can launch a tool panel. Return to the underlying workspace so
    // the renderer does not record that tool as Settings' own return target.
    if (!route && location.pathname !== '/settings') previous.current = location.pathname + location.search + location.hash
  }, [location, route])
  if (!route) return null
  const closeLabel = `Close ${route.label}`
  const close = () => {
    if (route === USAGE_ROUTE && location.state?.fromUsageSidebar === true) {
      void navigate(-1)
    } else {
      void navigate(previous.current, { replace: true })
    }
  }
  if (route === USAGE_ROUTE) {
    return <div role="dialog" aria-modal="true" aria-label={route.label}>
      <SettingsFrameSurface variant="fullscreen" title={route.label} closeLabel={closeLabel} onClose={close}>
        <BrowserPageSurface />
      </SettingsFrameSurface>
    </div>
  }
  return <OverlayView closeLabel={closeLabel} onClose={close} contentClassName={route === KANBAN_ROUTE ? 'pt-(--titlebar-height)' : undefined}>
    <BrowserPageSurface />
  </OverlayView>
}
