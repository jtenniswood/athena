import { androidPushRegistration, isAndroidApp, setAndroidPushActive } from './android'
import { apiFetch } from './connection'

let registration: { deviceId: string; token: string } | null = null
let registering: Promise<boolean> | undefined
let timer: number | undefined
let stopped = false
let bindingId: string | undefined

async function register(): Promise<boolean> {
  if (stopped) return false
  if (registering) return registering
  registering = (async () => {
    registration = await androidPushRegistration()
    if (!registration || stopped) return false
    bindingId ??= crypto.randomUUID()
    let prefs: { enabled?: boolean; kinds?: Record<string, boolean> } = {}
    try { prefs = JSON.parse(window.localStorage.getItem('hermes:native-notifications') || '{}') } catch { /* Use renderer defaults. */ }
    try {
      await apiFetch({ method: 'POST', path: '/api/athena/android/push', body: {
        ...registration, bindingId, enabled: prefs.enabled !== false, kinds: prefs.kinds,
        foreground: document.visibilityState === 'visible'
      } })
      if (stopped) return false
      await setAndroidPushActive(prefs.enabled !== false, bindingId)
      return true
    } catch { await setAndroidPushActive(false, bindingId); return false }
  })().finally(() => { registering = undefined })
  return registering
}

/** Fall back to the normal gateway when the optional push service is unconfigured. */
export async function androidPushGatewayUrl(url: string): Promise<string> {
  if (!isAndroidApp()) return url
  if (!await register() || !registration) return url
  if (!timer) {
    timer = window.setInterval(() => { void register() }, 15000)
    document.addEventListener('visibilitychange', () => { void register() })
  }
  const target = new URL(url)
  target.pathname = '/api/athena/android/ws'
  target.searchParams.set('device', registration.deviceId)
  return target.href
}

export async function stopAndroidPush(): Promise<void> {
  if (!isAndroidApp()) return
  stopped = true
  if (timer) window.clearInterval(timer)
  timer = undefined
  await registering
  await setAndroidPushActive(false, bindingId || '')
  if (registration) {
    try { await apiFetch({ method: 'DELETE', path: '/api/athena/android/push', body: { deviceId: registration.deviceId } }) }
    catch { /* Native delivery is disabled even when the server cannot be reached. */ }
  }
}

export async function resumeAndroidPush(): Promise<void> {
  if (!isAndroidApp()) return
  stopped = false
  await register()
}
