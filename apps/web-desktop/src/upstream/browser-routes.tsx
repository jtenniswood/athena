import { createContext, lazy, Suspense, useContext, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Routes, useLocation, type Location } from 'react-router'
import { appViewForPath, isOverlayView } from '@/app/routes'
import { registry } from '@/contrib/registry'
import { isBrowserToolRoute, SCHEDULED_TASKS_ROUTE } from '../experience/tool-routes'

const ScheduledTasksPage = lazy(() => import('../experience/scheduled-tasks-page'))
// Register before wiring mounts so the session router never treats this path as a chat ID.
const disposeScheduledTasks = registry.register({
  id: 'athena:scheduled-tasks',
  area: 'routes',
  title: SCHEDULED_TASKS_ROUTE.label,
  data: { path: SCHEDULED_TASKS_ROUTE.path },
  render: () => <Suspense fallback={<p role="status">Loading scheduled tasks…</p>}><ScheduledTasksPage /></Suspense>
})
if (import.meta.hot) import.meta.hot.dispose(disposeScheduledTasks)

const PageSurface = createContext(false)

export function browserRouteCoversWorkspace(pathname: string) {
  return isBrowserToolRoute(pathname) || isOverlayView(appViewForPath(pathname))
}

/** The page and the conversation have separate route contexts and one live instance each. */
export function BrowserPageRoutes({ children }: { children: ReactNode }) {
  return <PageSurface.Provider value>{children}</PageSurface.Provider>
}

/** Keep the last workspace route mounted while a browser or engine overlay is open. */
export function BrowserWorkspaceRoutes({ children }: { children: ReactNode }) {
  const location = useLocation()
  const page = useContext(PageSurface)
  const covered = browserRouteCoversWorkspace(location.pathname)
  const background = useRef<Location>({ pathname: '/', search: '', hash: '', state: null, key: 'browser-background' })
  useLayoutEffect(() => { if (!covered) background.current = location }, [covered, location])
  return <Routes location={page || !covered ? location : background.current}>{children}</Routes>
}
