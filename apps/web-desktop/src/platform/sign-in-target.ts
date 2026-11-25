/** Return to the current app route after signing in. */
export function browserReturnPath(): string {
  const { pathname, search, hash } = window.location
  return pathname.startsWith('//') ? '/' : `${pathname}${search}${hash}`
}

/** Open the Hermes login page; its backend owns account authentication. */
export function browserSignInTarget(returnTo?: string): { path: string; label: string } {
  const params = new URLSearchParams()
  if (returnTo) params.set('next', returnTo)
  return { path: `/login${params.size ? `?${params}` : ''}`, label: 'Sign in' }
}
