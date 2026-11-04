import { knownOwnerForSession } from '@/store/session-states'
import { isAndroidApp } from '../platform/android'
import { WEB_CONNECTION_ID } from '../platform/connection'
import { webNotify } from '../platform/notifications'

/** Capture the engine owner before delivery waits or later selection changes. */
export function installBrowserNotificationCommands(): () => void {
  if (isAndroidApp()) return () => {}
  const bridge = window.hermesDesktop, previous = bridge.notify
  const notify: typeof previous = payload => {
    const owner = payload.focusSessionId ? knownOwnerForSession(payload.sessionId || payload.focusSessionId) : undefined
    if (owner && typeof owner !== 'string' && owner.connectionId !== WEB_CONNECTION_ID) return Promise.resolve(false)
    const profile = typeof owner === 'string' ? owner : owner?.targetProfile || owner?.profile
    return webNotify(payload, profile)
  }
  bridge.notify = notify
  return () => { if (bridge.notify === notify) bridge.notify = previous }
}
