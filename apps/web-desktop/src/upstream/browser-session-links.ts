import { parseSessionRefValue } from '@/lib/session-refs'

/** A shareable chat URL for native browser link gestures and context menus. */
export function browserSessionRefHref(value: string): string {
  const { sessionId } = parseSessionRefValue(value)
  if (!sessionId) return ''
  const url = new URL('.', window.location.href)
  url.hash = `/${encodeURIComponent(sessionId)}`
  return url.href
}
