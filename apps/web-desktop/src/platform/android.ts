import type { HermesNotification } from '../upstream/types'

type Permission = NotificationPermission
interface AndroidPort {
  postMessage(message: string): void
  onmessage: ((event: { data: string }) => void) | null
}

let permission: Permission = 'default'
let activePort: AndroidPort | undefined
let nextId = 0
let pushActive = false
const requests = new Map<string, { resolve: (value: unknown) => void; timer: number }>()

function port(): AndroidPort | undefined {
  return (window as Window & { AthenaAndroid?: AndroidPort }).AthenaAndroid
}

export function isAndroidApp(): boolean { return Boolean(port()) }

async function call(method: string, payload?: unknown): Promise<unknown> {
  const bridge = port()
  if (!bridge) throw new Error('Android bridge unavailable')
  if (activePort !== bridge) {
    activePort = bridge
    bridge.onmessage = event => {
      try {
        const message = JSON.parse(event.data) as { id: string; value: unknown }
        const request = requests.get(message.id)
        if (!request) return
        window.clearTimeout(request.timer)
        requests.delete(message.id)
        request.resolve(message.value)
      } catch { /* Ignore invalid native responses. */ }
    }
  }
  return new Promise((resolve, reject) => {
    const id = String(++nextId)
    const timer = window.setTimeout(() => {
      requests.delete(id)
      reject(new Error('Android request timed out'))
    }, method === 'requestPermission' || method === 'openSignIn' ? 120_000 : 5_000)
    requests.set(id, { resolve, timer })
    try { bridge.postMessage(JSON.stringify({ id, method, payload })) }
    catch { window.clearTimeout(timer); requests.delete(id); reject(new Error('Android bridge unavailable')) }
  })
}

export function androidNotificationPermission(): Permission { return permission }

export async function refreshAndroidNotificationPermission(request = false): Promise<Permission> {
  try {
    const result = await call(request ? 'requestPermission' : 'permission')
    if (result === 'granted' || result === 'denied' || result === 'default') permission = result
  } catch { /* Keep the last known permission when resuming a stale page. */ }
  window.dispatchEvent(new Event('athena:notification-permission'))
  return permission
}

export async function androidNotify(payload: HermesNotification): Promise<boolean> {
  if (pushActive && (payload.kind === 'turnDone' || payload.kind === 'turnError')) return true
  try { return await call('notify', payload) === true }
  catch { return false }
}

export async function androidPushRegistration(): Promise<{ deviceId: string; token: string } | null> {
  try {
    const value = await call('pushRegistration') as { deviceId?: unknown; token?: unknown } | null
    return value && typeof value.deviceId === 'string' && typeof value.token === 'string'
      ? { deviceId: value.deviceId, token: value.token } : null
  } catch { return null }
}

export async function setAndroidPushActive(enabled: boolean, bindingId: string): Promise<void> {
  try { await call('pushEnabled', { enabled, bindingId }); pushActive = enabled }
  catch { pushActive = false }
  window.dispatchEvent(new Event('athena:notification-permission'))
}

export function androidPushActive(): boolean { return pushActive }

export async function androidOpenSignIn(path: string): Promise<boolean> {
  try { return await call('openSignIn', { path }) === true } catch { return false }
}

export async function androidNavigationReady(result: { ready: boolean; reason?: string }): Promise<void> {
  try { await call('navigationReady', result) } catch { /* Native navigation remains blocked. */ }
}
