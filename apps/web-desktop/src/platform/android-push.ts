import { androidPushRegistration, androidPushDiagnostics, androidVisibleSession, isAndroidApp, setAndroidPushActive } from './android'
import { apiFetch } from './connection'

let registration: { deviceId: string; token: string; refreshKey?: string; tokenVersion?: number } | null = null
let registering: Promise<boolean> | undefined
let timer: number | undefined
let stopped = false
let bindingId: string | undefined
let diagnosticsGeneration = 0

async function register(): Promise<boolean> {
  if (stopped) return false
  if (registering) return registering
  registering = (async () => {
    registration = await androidPushRegistration()
    if (!registration || stopped) return false
    // The binding survives reloads; explicit sign-out revokes it.
    try {
      bindingId ??= window.localStorage.getItem('athena:android-push-binding') || crypto.randomUUID()
      window.localStorage.setItem('athena:android-push-binding', bindingId)
    } catch { bindingId ??= crypto.randomUUID() }
    let prefs: { enabled?: boolean; kinds?: Record<string, boolean> } = {}
    try { prefs = JSON.parse(window.localStorage.getItem('hermes:native-notifications') || '{}') } catch { /* Use renderer defaults. */ }
    try {
      const bound = await apiFetch<{ bindingId?: string }>({ method: 'POST', path: '/api/athena/android/push', body: {
        ...registration, bindingId, accountScopedBinding: true, enabled: prefs.enabled !== false, kinds: prefs.kinds,
        foreground: Boolean(androidVisibleSession())
      } })
      if (stopped) return false
      await setAndroidPushActive(prefs.enabled !== false, bound.bindingId || bindingId, registration.token, registration.tokenVersion)
      const generation = ++diagnosticsGeneration
      void reportDelivery(registration.deviceId, generation)
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
