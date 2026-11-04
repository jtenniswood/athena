import type { HermesNotification } from '../upstream/types'
import { browserCapabilities } from './capabilities'
import { activateBrowserNotificationCallback, browserNotificationSource, browserNotificationCallbackReady, routeBrowserNotification } from './notification-navigation'
import { withBrowserSessionProfile } from './session-route'
import { androidNotificationPermission, androidNotify, isAndroidApp, refreshAndroidNotificationPermission } from './android'

const WEB_NOTIFICATION_READY_TIMEOUT_MS = 750

export type BrowserNotificationPermission = NotificationPermission | 'unsupported' | 'insecure'

export function browserNotificationPermission(): BrowserNotificationPermission {
  if (isAndroidApp()) return androidNotificationPermission()
  if (!window.isSecureContext) return 'insecure'
  return browserCapabilities().notifications ? Notification.permission : 'unsupported'
}

/** Call directly from a user click; response events cannot request permission. */
export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (isAndroidApp()) return refreshAndroidNotificationPermission(true)
  const permission = browserNotificationPermission()
  if (permission !== 'default') return permission
  try {
    return await Notification.requestPermission()
  } catch {
    return browserNotificationPermission()
  }
}

async function readyServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {return null}

  try {
    // Do not let a notification wait indefinitely for the PWA registration.
    // This also keeps the bridge useful on plain HTTP dev/preview servers.
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>(resolve => window.setTimeout(() => resolve(null), WEB_NOTIFICATION_READY_TIMEOUT_MS))
    ])
  } catch {
    return null
  }
}

async function requestNotificationWorker(worker: ServiceWorker | null, message: unknown): Promise<unknown> {
  if (!worker) return null
  return new Promise(resolve => {
    const channel = new MessageChannel()
    const finish = (ready: unknown) => { window.clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(ready) }
    const timer = window.setTimeout(() => finish(false), WEB_NOTIFICATION_READY_TIMEOUT_MS)
    channel.port1.onmessage = event => finish(event.data)
    try { worker.postMessage(message, [channel.port2]) }
    catch { finish(false) }
  })
}

async function publishPersistentNotification(registration: ServiceWorkerRegistration, title: string, options: NotificationOptions): Promise<void> {
  const publish = async () => {
    let previous: Notification[] = []
    if (options.tag) {
      try { previous = await registration.getNotifications({ tag: options.tag }) } catch { /* Delivery still works without enumeration. */ }
    }
    await registration.showNotification(title, options)
    for (const notification of previous) {
      const data = notification.data
      if (!data?.source || !data?.notifyId || (data.source === options.data?.source && data.notifyId === options.data?.notifyId)) continue
      if (!activateBrowserNotificationCallback({ ...data, dismiss: true })) {
        await requestNotificationWorker(registration.active, { type: 'ATHENA_NOTIFICATION_DISMISS', data })
      }
    }
  }
  // Serialize same-tag replacements across windows so every superseded callback is released.
  if (options.tag && navigator.locks) await navigator.locks.request(`athena.notification:${registration.scope}:${options.tag}`, publish)
  else await publish()
}

export interface BrowserNotificationTargets {
  activate?: string | null
  actions?: { id: string; text: string; activate?: string | null }[]
}

export async function webNotify(payload: HermesNotification, profile?: string, targets: BrowserNotificationTargets = {}): Promise<boolean> {
  if (isAndroidApp()) return androidNotify(payload)
  if (browserNotificationPermission() !== 'granted') return false

  const title = payload.kind === 'turnDone' ? 'Athena · Response ready' : payload.title ?? 'Athena'
  const focusSessionId = payload.focusSessionId
  let target = new URL(window.location.href)
  if (focusSessionId) {
    target.hash = '/' + encodeURIComponent(focusSessionId)
    target = withBrowserSessionProfile(target, profile)
  }
  if (targets.activate) target.hash = targets.activate
  const navigates = Boolean(focusSessionId || targets.activate)
  const callback = payload.notifyId ? { source: browserNotificationSource(), notifyId: payload.notifyId } : undefined
  const actions = targets.actions?.filter(action => action.id && action.text).map(action => {
    const url = new URL(target)
    if (action.activate) url.hash = action.activate
    return { id: action.id, title: action.text, url: url.href, navigate: Boolean(action.activate || navigates) }
  })
  const options: NotificationOptions = {
    body: payload.body,
    icon: '/athena.png',
    badge: '/athena.png',
    silent: payload.silent,
    tag: payload.tag,
    data: { url: target.href, navigate: navigates, ...callback, ...(actions?.length ? { actions } : {}) }
  }

  // Persistent notifications work on mobile as well as desktop, including
  // the Settings test while the page is visible.
  const registration = await readyServiceWorkerRegistration()

  const supportsCallbacks = registration && (callback || actions?.length)
    ? (await requestNotificationWorker(registration.active, { type: 'ATHENA_NOTIFICATION_CAPABILITIES' }) as { notificationCallbacks?: number } | null)?.notificationCallbacks === 1 : true
  if (registration && supportsCallbacks) {
    try {
      await publishPersistentNotification(registration, title, { ...options, ...(actions?.length ? { actions: actions.map(action => ({ action: action.id, title: action.title })) } : {}) })
      return true
    } catch {
      // Fall through to the page notification when the SW is unavailable.
    }
  }

  try {
    const notification = new Notification(title, options)
    notification.onclick = () => {
      if (callback) activateBrowserNotificationCallback(callback)
      if ((!navigates && (!callback || browserNotificationCallbackReady(callback))) || routeBrowserNotification(target.href, !navigates)) window.focus()
      else window.open(target.href, '_blank', 'noopener,noreferrer')
      notification.close()
    }

    const dismiss = () => { if (callback) activateBrowserNotificationCallback({ ...callback, dismiss: true }) }
    notification.onclose = dismiss
    notification.onerror = dismiss
    return true
  } catch {
    return false
  }
}
