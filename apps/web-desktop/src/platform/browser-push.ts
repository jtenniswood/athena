import { isAndroidApp } from './android'
import { apiFetch } from './connection'

const path = '/api/athena/browser/push'
const installationKey = 'athena:browser-push'
const preferencesKey = 'hermes:native-notifications'
const mutedKey = 'hermes.desktop.hapticsMuted'
let ready = false
let pending: Promise<boolean> | undefined
let stopped = false
let publicKey: Promise<string | undefined> | undefined

function browserPushKey() {
  publicKey ??= apiFetch<{ publicKey: string }>({ path, timeoutMs: 6000 })
    .then(result => result.publicKey || undefined)
    .catch(() => undefined)
    .then(key => { if (!key) publicKey = undefined; return key })
  return publicKey
}

export function browserPushSupported(): boolean {
  return !isAndroidApp() && window.isSecureContext && 'PushManager' in window && 'serviceWorker' in navigator
}

export function browserPushEnabled(): boolean { return Boolean(installationId()) }

export function browserPushReady(): boolean { return ready && browserPushEnabled() }

function publish(status: boolean) {
  if (ready !== status) {
    ready = status
    window.dispatchEvent(new Event('athena:browser-push'))
  }
  return status
}

function installationId(): string | null {
  try { return localStorage.getItem(installationKey) } catch { return null }
}

function worker(): Promise<ServiceWorkerRegistration | undefined> {
  return navigator.serviceWorker.getRegistration('/')
}

export async function prepareBrowserPush(): Promise<boolean> {
  if (!browserPushSupported()) return false
  try {
    const registration = await worker()
    const active = registration?.active
    if (!active || !registration?.pushManager) return false
    const supportsPush = await new Promise<boolean>(resolve => {
      const channel = new MessageChannel()
      const finish = (supported: boolean) => {
        window.clearTimeout(timeout)
        channel.port1.close()
        resolve(supported)
      }
      const timeout = window.setTimeout(() => finish(false), 750)
      channel.port1.onmessage = event => finish(event.data?.browserPush === 1)
      try { active.postMessage({ type: 'ATHENA_NOTIFICATION_CAPABILITIES' }, [channel.port2]) }
      catch { channel.port2.close(); finish(false) }
    })
    return supportsPush && Boolean(await browserPushKey())
  } catch { return false }
}

function sendRegistration(deviceId: string, subscription: PushSubscription): Promise<{ watchingReplies?: boolean }> {
  let prefs: { enabled?: boolean; kinds?: { turnDone?: boolean } } = {}
  try { prefs = JSON.parse(localStorage.getItem(preferencesKey) || '{}') } catch { /* Use the renderer defaults. */ }
  const [route, query] = location.hash.split('?')
  const visibleSession = document.visibilityState === 'visible' && document.hasFocus() && route.startsWith('#/')
    ? route.slice(2) : ''
  const visibleProfile = new URLSearchParams(query).get('profile') || new URL(location.href).searchParams.get('profile')
  return apiFetch({
    method: 'POST', path, timeoutMs: 6000, body: {
      deviceId, subscription: subscription.toJSON(), enabled: prefs?.enabled !== false && prefs?.kinds?.turnDone !== false,
      visibleSession: visibleSession && decodeURIComponent(visibleSession),
      visibleProfile, silent: localStorage.getItem(mutedKey) === 'true'
    }
  })
}

export async function syncBrowserPush(): Promise<boolean> {
  if (stopped || !browserPushSupported()) return false
  const id = installationId()
  if (!id) return ready ? publish(false) : false
  if (pending) return pending
  pending = (async () => {
    try {
      if (Notification.permission !== 'granted') {
        await revokeBrowserPush()
        return publish(false)
      }
      const subscription = await (await worker())?.pushManager.getSubscription()
      if (!subscription || stopped || installationId() !== id) return publish(false)
      const status = await sendRegistration(id, subscription)
      return publish(!stopped && installationId() === id && status.watchingReplies === true)
    } catch { return publish(false) }
  })().finally(() => { pending = undefined })
  return pending
}

export async function refreshBrowserPush(): Promise<boolean> {
  await pending
  return syncBrowserPush()
}

export async function setBrowserPushEnabled(enabled: boolean): Promise<boolean> {
  if (!browserPushSupported()) return false
  if (!enabled) {
    await stopBrowserPush()
    return true
  }
  stopped = false
  const registration = await worker()
  if (!registration?.active || Notification.permission !== 'granted') throw new Error('Allow notifications and wait for Athena to finish loading.')
  const publicKey = await browserPushKey()
  if (!publicKey) throw new Error('Browser push is unavailable.')
  await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey })
  localStorage.setItem(installationKey, installationId() || crypto.randomUUID())
  return syncBrowserPush()
}

export async function testBrowserPush(): Promise<void> {
  const id = installationId()
  if (!id || !await syncBrowserPush()) throw new Error('Background delivery is unavailable')
  await apiFetch({ method: 'POST', path: path + '/test', timeoutMs: 10000, body: { deviceId: id } })
}

async function revokeBrowserPush() {
  const id = installationId()
  if (!id) return
  localStorage.removeItem(installationKey)
  await Promise.allSettled([
    apiFetch({ method: 'DELETE', path, timeoutMs: 4000, body: { deviceId: id } }),
    (async () => (await (await worker())?.pushManager.getSubscription())?.unsubscribe())()
  ])
}

export async function stopBrowserPush(): Promise<void> {
  if (!browserPushSupported() || !installationId()) return
  stopped = true
  publish(false)
  await pending
  try { await revokeBrowserPush() } catch { /* The preference stays disabled on this browser. */ }
}

export function installBrowserPush(): () => void {
  if (!browserPushSupported()) return () => {}
  const sync = () => { void syncBrowserPush() }
  const storage = (event: StorageEvent) => {
    if (event.key === installationKey) stopped = false
    if (event.key === installationKey || event.key === preferencesKey || event.key === mutedKey) refresh()
  }
  const events = ['focus', 'blur', 'online', 'hashchange']
  const refresh = () => { void refreshBrowserPush() }
  for (const event of events) window.addEventListener(event, refresh)
  window.addEventListener('storage', storage)
  document.addEventListener('visibilitychange', refresh)
  const timer = window.setInterval(sync, 30_000)
  sync()
  return () => {
    for (const event of events) window.removeEventListener(event, refresh)
    window.removeEventListener('storage', storage)
    document.removeEventListener('visibilitychange', refresh)
    window.clearInterval(timer)
  }
}
