import { useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { OverlayView } from '../upstream/browser-api'
import { useBrowserEngine } from './engine'
import { BROWSER_TOOL_ROUTES } from './tool-routes'

/** Tool routes cover the workspace; closing returns to the complete prior URL. */
export function BrowserToolModal() {
  const { surfaces: { Page: BrowserPageSurface } } = useBrowserEngine()
  const location = useLocation(), navigate = useNavigate()
  const route = BROWSER_TOOL_ROUTES.find(item => item.path === location.pathname)
  const previous = useRef('/')
  useLayoutEffect(() => {
    // Settings can launch a tool panel. Return to the underlying workspace so
    // the renderer does not record that tool as Settings' own return target.
    if (!route && location.pathname !== '/settings') previous.current = location.pathname + location.search + location.hash
  }, [location, route])
  if (!route) return null
  return <OverlayView closeLabel={`Close ${route.label}`} onClose={() => navigate(previous.current, { replace: true })}>
    <BrowserPageSurface />
  </OverlayView>
}
