import { isAndroidApp } from './android'
import { androidPushDeviceId, syncAndroidPushPreferences } from './android-push'
import { browserPushDeviceId, browserPushSupported, refreshBrowserPush, setBrowserPushEnabled } from './browser-push'
import { apiFetch } from './connection'
import { requestBrowserNotificationPermission } from './notifications'

export interface ReminderChat {
  sessionId: string
  profile: string
}

function reminderPath({ sessionId, profile }: ReminderChat) {
  const android = isAndroidApp()
  const device = android ? androidPushDeviceId() : browserPushDeviceId()
  if (!device) return null
  const platform = android ? 'android' : 'browser'
  return '/api/athena/' + platform + '/push/reminder?' + new URLSearchParams({ device, session: sessionId, profile })
}

export async function readChatReminder(chat: ReminderChat): Promise<number | null> {
  const path = reminderPath(chat)
  return path ? (await apiFetch<{ dueAt: number | null }>({ path, timeoutMs: 6000 })).dueAt : null
}

export async function scheduleChatReminder(chat: ReminderChat, dueAt: number): Promise<void> {
  const android = isAndroidApp()
  if (!android && !browserPushSupported()) {
    throw new Error('Background notifications are unavailable here. On iPhone or iPad, open Athena from your Home Screen.')
  }
  if (await requestBrowserNotificationPermission() !== 'granted') {
    throw new Error('Allow Athena notifications on this device to set a reminder.')
  }
  if (android) {
    if (!await syncAndroidPushPreferences()) {
      throw new Error('Android background delivery is unavailable. Check Settings → Notifications.')
    }
  } else if (!await (browserPushDeviceId() ? refreshBrowserPush() : setBrowserPushEnabled(true))) {
    throw new Error('Check background delivery in Settings → Notifications on this device.')
  }
  const path = reminderPath(chat)
  if (!path) throw new Error('Enable background delivery in Settings → Notifications on this device.')
  await apiFetch({ path, method: 'POST', body: { dueAt }, timeoutMs: 6000 })
}

export async function cancelChatReminder(chat: ReminderChat): Promise<void> {
  const path = reminderPath(chat)
  if (!path) throw new Error('Background delivery is unavailable on this device.')
  await apiFetch({ path, method: 'DELETE', timeoutMs: 6000 })
}
