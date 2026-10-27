import type { HermesNotification } from '../upstream/types'
import { browserCapabilities } from './capabilities'
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

export async function webNotify(payload: HermesNotification): Promise<boolean> {
  if (isAndroidApp()) return androidNotify(payload)
  if (browserNotificationPermission() !== 'granted') return false

  const title = payload.kind === 'turnDone' ? 'Athena · Response ready' : payload.title ?? 'Athena'
  const target = new URL(window.location.href)
  if (payload.focusSessionId) target.hash = '/' + encodeURIComponent(payload.focusSessionId)
  const options: NotificationOptions = {
    body: payload.body,
    icon: '/athena.png',
    badge: '/athena.png',
    silent: payload.silent,
    tag: payload.tag,
    data: { url: target.href }
  }

  // Persistent notifications work on mobile as well as desktop, including
  // the Settings test while the page is visible.
  const registration = await readyServiceWorkerRegistration()

  if (registration) {
    try {
      await registration.showNotification(title, options)
      return true
    } catch {
      // Fall through to the page notification when the SW is unavailable.
    }
  }

  try {
    const notification = new Notification(title, options)
    notification.onclick = () => {
      window.focus()
      if (payload.focusSessionId) window.location.hash = target.hash
      notification.close()
    }

    return true
  } catch {
    return false
  }
}
