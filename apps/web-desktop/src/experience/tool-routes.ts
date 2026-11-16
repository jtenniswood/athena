export const SCHEDULED_TASKS_ROUTE = { path: '/scheduled-tasks', label: 'Scheduled', icon: 'watch' } as const

export const USAGE_ROUTE = { path: '/usage', label: 'Usage' } as const

export const BROWSER_TOOL_ROUTES = [
  { path: '/capabilities', label: 'Capabilities', icon: 'symbol-misc' },
  { path: '/messaging', label: 'Messaging', icon: 'comment' },
  { path: '/artifacts', label: 'Artifacts', icon: 'files' },
  SCHEDULED_TASKS_ROUTE
] as const

export const BROWSER_PAGE_ROUTES = [...BROWSER_TOOL_ROUTES, USAGE_ROUTE] as const

export function isBrowserPageRoute(pathname: string) {
  return BROWSER_PAGE_ROUTES.some(route => route.path === pathname)
}
