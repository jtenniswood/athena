/** Reuse this document only for hash navigation; query changes reload its work. */
export function routeBrowserNotification(href: string, focusOnly = false): boolean {
  try {
    if (document.getElementById('root')?.inert) return false
    const current = new URL(window.location.href)
    const target = new URL(href, current)
    if (target.origin !== current.origin || target.pathname !== current.pathname || target.search !== current.search) return false
    if (!focusOnly && target.hash !== current.hash) window.location.hash = target.hash
    return true
  } catch { return false }
}

export interface BrowserNotificationCallback {
  source?: string
  notifyId?: string
  actionId?: string
  dismiss?: boolean
  expiresAt?: number
}

type CallbackOwner = (notifyId: string, actionId?: string, dismiss?: boolean) => void
let callbackOwner: CallbackOwner | undefined
let source: string | undefined

/** Identifies this document; the engine retains all per-notification callbacks. */
export function browserNotificationSource(): string { return source ??= crypto.randomUUID() }

export function installBrowserNotificationCallbacks(owner: CallbackOwner): () => void {
  const previous = callbackOwner
  callbackOwner = owner
  return () => { if (callbackOwner === owner) callbackOwner = previous }
}

export function browserNotificationCallbackReady(message: BrowserNotificationCallback): boolean {
  return message.dismiss !== true && !document.getElementById('root')?.inert &&
    !(typeof message.expiresAt === 'number' && message.expiresAt < Date.now())
}

/** Only the emitting document may consume its engine callbacks. */
export function activateBrowserNotificationCallback(message: BrowserNotificationCallback): boolean {
  if (!source || message.source !== source || typeof message.notifyId !== 'string' || !message.notifyId || !callbackOwner) return false
  try {
    callbackOwner(message.notifyId, typeof message.actionId === 'string' ? message.actionId : undefined,
      !browserNotificationCallbackReady(message))
  } catch (error) { console.error('Plugin notification callback failed', error) }
  return true
}
