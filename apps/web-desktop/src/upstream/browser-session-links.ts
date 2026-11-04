import { sessionRoute } from '@/app/routes'
import { withBrowserSessionProfile } from '../platform/session-route'
import { parseSessionRefValue } from '@/lib/session-refs'

/** A shareable chat URL for native browser link gestures and context menus. */
export function browserSessionRefHref(value: string): string {
  const { profile, sessionId } = parseSessionRefValue(value)
  if (!sessionId) return ''
  const url = new URL('.', window.location.href)
  url.hash = sessionRoute(sessionId)
  return withBrowserSessionProfile(url, profile).href
}
