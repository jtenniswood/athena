export const SCHEDULED_TASKS_ROUTE = { path: '/scheduled-tasks', label: 'Scheduled', icon: 'watch' } as const

export const BROWSER_MORE_CONTROL_ROUTES = [
  { path: '/capabilities', label: 'Capabilities', icon: 'symbol-misc' },
  { path: '/messaging', label: 'Messaging', icon: 'comment' },
  { path: '/artifacts', label: 'Artifacts', icon: 'files' },
  SCHEDULED_TASKS_ROUTE
] as const

export const BROWSER_TOOL_ROUTES = BROWSER_MORE_CONTROL_ROUTES

export function isBrowserToolRoute(pathname: string) {
  return BROWSER_TOOL_ROUTES.some(route => route.path === pathname)
}
