import { resolveHermesOpenPath } from '@/lib/hermes-open-target'
import { clearPluginNotifyHandlers, invokePluginNotifyAction, invokePluginNotifyActivate } from '@/store/native-notifications'
import { installBrowserNotificationCallbacks } from '../platform/notification-navigation'
import { knownOwnerForSession } from '@/store/session-states'
import { isAndroidApp } from '../platform/android'
import { WEB_CONNECTION_ID } from '../platform/connection'
import { webNotify } from '../platform/notifications'

/** Capture the engine owner before delivery waits or later selection changes. */
export function installBrowserNotificationCommands(): () => void {
  if (isAndroidApp()) return () => {}
  const stopCallbacks = installBrowserNotificationCallbacks((notifyId, actionId, dismiss) => {
    try {
      if (!dismiss) {
        if (actionId) invokePluginNotifyAction(notifyId, actionId)
        else invokePluginNotifyActivate(notifyId)
      }
    } finally { clearPluginNotifyHandlers(notifyId) }
  })
  const bridge = window.hermesDesktop, previous = bridge.notify
  const notify: typeof previous = payload => {
    const owner = payload.focusSessionId ? knownOwnerForSession(payload.sessionId || payload.focusSessionId) : undefined
    const allowed = !owner || typeof owner === 'string' || owner.connectionId === WEB_CONNECTION_ID
    const notifyId = payload.notifyId
    const profile = typeof owner === 'string' ? owner : owner?.targetProfile || owner?.profile
    const targets = {
      activate: resolveHermesOpenPath(payload.activate),
      actions: !payload.sessionId || payload.notifyId || payload.activate
        ? payload.actions?.map(action => ({ ...action, activate: resolveHermesOpenPath(action.activate) })) : undefined
    }
    const delivery = allowed ? webNotify(payload, profile, targets) : Promise.resolve(false)
    return delivery.then(delivered => {
      if (!delivered && notifyId) clearPluginNotifyHandlers(notifyId)
      return delivered
    }, error => {
      if (notifyId) clearPluginNotifyHandlers(notifyId)
      throw error
    })
  }
  bridge.notify = notify
  return () => { stopCallbacks(); if (bridge.notify === notify) bridge.notify = previous }
}
