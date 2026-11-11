import { androidPushRegistration, androidPushDiagnostics, androidVisibleSession, isAndroidApp, setAndroidPushActive } from './android'
import { apiFetch } from './connection'

let registration: { deviceId: string; token: string; refreshKey?: string; tokenVersion?: number; previewKey?: string } | null = null
let registering: Promise<boolean> | undefined
let timer: number | undefined
let stopped = false
let bindingId: string | undefined
let diagnosticsGeneration = 0
const backgroundAlertsKey = 'athena:android-background-alerts'
let backgroundAlerts: boolean | undefined

export function androidBackgroundAlerts(): boolean {
  if (backgroundAlerts !== undefined) return backgroundAlerts
  try { return window.localStorage.getItem(backgroundAlertsKey) !== 'off' }
  catch { return true }
}

export function setAndroidBackgroundAlerts(enabled: boolean): Promise<boolean> {
  backgroundAlerts = enabled
  try { window.localStorage.setItem(backgroundAlertsKey, enabled ? 'on' : 'off') } catch { /* Use the current choice for this page. */ }
  return syncAndroidPushPreferences()
}

export async function syncAndroidPushPreferences(): Promise<boolean> {
  if (!isAndroidApp()) return false
  // An in-flight heartbeat may already have read the previous settings.
  await registering
  return register()
}

async function register(): Promise<boolean> {
  if (stopped) return false
  if (registering) return registering
  registering = (async () => {
    const device = await androidPushRegistration()
    if (stopped) return false
    if (!device) {
      await androidPushDiagnostics('Firebase registration unavailable on this device')
      return false
    }
    registration = device
    // The binding survives reloads; explicit sign-out revokes it.
    try {
      bindingId ??= window.localStorage.getItem('athena:android-push-binding') || crypto.randomUUID()
      window.localStorage.setItem('athena:android-push-binding', bindingId)
    } catch { bindingId ??= crypto.randomUUID() }
    let prefs: { enabled?: boolean; kinds?: Record<string, boolean> } = {}
    try { prefs = JSON.parse(window.localStorage.getItem('hermes:native-notifications') || '{}') } catch { /* Use renderer defaults. */ }
    const enabled = prefs?.enabled !== false && androidBackgroundAlerts()
    try {
      const bound = await apiFetch<{ bindingId?: string }>({ method: 'POST', path: '/api/athena/android/push', body: {
        ...registration, bindingId, accountScopedBinding: true, enabled, kinds: prefs?.kinds,
        foreground: Boolean(androidVisibleSession())
      } })
      if (stopped) return false
      await setAndroidPushActive(enabled, bound.bindingId || bindingId, registration.token, registration.tokenVersion)
      const generation = ++diagnosticsGeneration
      if (enabled) void reportDelivery(registration.deviceId, generation)
      else void androidPushDiagnostics('Background delivery is off')
      return true
    } catch { await setAndroidPushActive(false, bindingId); await androidPushDiagnostics('Registration unavailable; open Athena to retry'); return false }
  })().finally(() => { registering = undefined })
  return registering
}

async function reportDelivery(deviceId: string, generation: number): Promise<void> {
  try {
    const status = await apiFetch<{ persistent: boolean; pending: number; lastDelivery: { state: string; attempts: number } | null }>({
      method: 'GET', path: '/api/athena/android/push?device=' + encodeURIComponent(deviceId), timeoutMs: 4000
    })
    if (stopped || generation !== diagnosticsGeneration) return
    const last = status.lastDelivery
    await androidPushDiagnostics(`${status.persistent ? 'Persistent registration' : 'Temporary registration'} · ${status.pending} pending` +
      (last ? ` · Last: ${last.state === 'accepted' ? 'Accepted by Firebase' : last.state} (${last.attempts} attempts)` : ''))
  } catch { /* Optional diagnostics must not delay connecting to chat or block older servers. */ }
}

export async function testAndroidPush(): Promise<void> {
  if (!await syncAndroidPushPreferences() || !registration) throw new Error('Push registration is unavailable.')
  await apiFetch({ method: 'POST', path: '/api/athena/android/push/test', body: { deviceId: registration.deviceId } })
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
  diagnosticsGeneration++
  try { window.localStorage.removeItem('athena:android-push-binding') } catch { /* Native revocation still runs. */ }
  if (timer) window.clearInterval(timer)
  timer = undefined
  await registering
  await setAndroidPushActive(false, bindingId || '')
  if (registration) {
    try { await apiFetch({ method: 'DELETE', path: '/api/athena/android/push', body: { deviceId: registration.deviceId } }) }
    catch { /* Native delivery is disabled even when the server cannot be reached. */ }
  }
  bindingId = undefined
}

export async function resumeAndroidPush(): Promise<void> {
  if (!isAndroidApp()) return
  stopped = false
  await register()
}
