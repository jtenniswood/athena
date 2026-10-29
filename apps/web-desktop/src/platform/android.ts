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
const requests = new Map<string, { resolve: (value: unknown) => void; timer: number; reject: (error: Error) => void; onChange?: (id: string) => void }>()

function port(): AndroidPort | undefined {
  return (window as Window & { AthenaAndroid?: AndroidPort }).AthenaAndroid
}

export function isAndroidApp(): boolean { return Boolean(port()) }

async function call(method: string, payload?: unknown, onChange?: (id: string) => void): Promise<unknown> {
  const bridge = port()
  if (!bridge) throw new Error('Android bridge unavailable')
  if (activePort !== bridge) {
    activePort = bridge
    bridge.onmessage = event => {
      try {
        const message = JSON.parse(event.data) as { id: string; value: unknown; error?: { code: string; message: string } }
        const request = requests.get(message.id)
        if (!request) return
        const change = message.value as { status?: string; id?: unknown } | null
        if (!message.error && change?.status === 'changed' && typeof change.id === 'string' && request.onChange) {
          request.onChange(change.id)
          return
        }
        window.clearTimeout(request.timer)
        requests.delete(message.id)
        if (message.error) request.reject(new Error(`${message.error.code}: ${message.error.message}`))
        else request.resolve(message.value)
      } catch { /* Ignore invalid native responses. */ }
    }
  }
  return new Promise((resolve, reject) => {
    const id = String(++nextId)
    // Menus settle on selection, dismissal or host lifecycle cleanup, not a timer.
    const timer = method === 'actionMenu' ? 0 : window.setTimeout(() => {
      requests.delete(id)
      reject(new Error('Android request timed out'))
    }, method === 'requestPermission' || method === 'openSignIn' ? 120_000 : 5_000)
    requests.set(id, { resolve, reject, timer, onChange })
    try { bridge.postMessage(JSON.stringify({ id, protocol: 1, method, payload })) }
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

export async function androidPushRegistration(): Promise<{ deviceId: string; token: string; refreshKey?: string; tokenVersion?: number } | null> {
  try {
    const value = await call('pushRegistration') as { deviceId?: unknown; token?: unknown; refreshKey?: unknown; tokenVersion?: unknown } | null
    return value && typeof value.deviceId === 'string' && typeof value.token === 'string'
      ? { deviceId: value.deviceId, token: value.token, ...(typeof value.refreshKey === 'string' ? { refreshKey: value.refreshKey } : {}), ...(typeof value.tokenVersion === 'number' ? { tokenVersion: value.tokenVersion } : {}) } : null
  } catch { return null }
}

export async function setAndroidPushActive(enabled: boolean, bindingId: string, token?: string, tokenVersion?: number): Promise<void> {
  try { await call('pushEnabled', { enabled, bindingId, token, tokenVersion }); pushActive = enabled }
  catch { pushActive = false }
  window.dispatchEvent(new Event('athena:notification-permission'))
}

export function androidPushActive(): boolean { return pushActive }

export async function androidOpenSignIn(path: string): Promise<boolean> {
  try { return await call('openSignIn', { path }) === true } catch { return false }
}

export async function androidNavigationReady(result: { ready: boolean; reason?: string; requestId?: string }): Promise<void> {
  try { await call('navigationReady', result) } catch { /* Native navigation remains blocked. */ }
}

export interface AndroidHost {
  protocol: 1
  appVersion: string
  capabilities: string[]
  insets: 'native'
  typography: 'platform'
}

let host: Promise<AndroidHost | null> | undefined
export function androidHost(): Promise<AndroidHost | null> {
  return host ??= call('hello', { protocol: 1 }).then(value => {
    const result = value as AndroidHost | null
    return result?.protocol === 1 && Array.isArray(result.capabilities) ? result : null
  }).catch(() => { host = undefined; return null })
}

/** Render the entry first. Only its following effect may hand over native chrome. */
export async function androidAppSettingsMenu(mounted: boolean, rendered = false): Promise<boolean> {
  if (mounted && !rendered) {
    const host = await androidHost()
    // Legacy APKs expose no hello method. Keep their header until the row is mounted.
    return host ? host.capabilities.includes('settings-menu') : true
  }
  try { return await call('appSettingsMenu', { mounted, rendered }) === true } catch { return false }
}

export async function androidOpenAppSettings(): Promise<boolean> {
  try { return await call('appSettings') === true } catch { return false }
}

export interface AndroidMenuItem {
  id: string
  label: string
  description?: string
  disabled?: boolean
  destructive?: boolean
  checked?: boolean
  keepOpen?: boolean
  submenu?: boolean
  children?: AndroidMenuGroup[]
}
export interface AndroidMenuGroup {
  label?: string
  selection?: 'single'
  items: AndroidMenuItem[]
}
export interface AndroidActionMenu {
  id: string
  title: string
  compact: boolean
  x: number
  y: number
  viewportWidth: number
  groups: AndroidMenuGroup[]
  backId?: string
}
export type AndroidMenuResult = { status: 'selected'; id: string } | { status: 'dismissed' } | { status: 'unavailable' }

export async function androidOpenActionMenu(menu: AndroidActionMenu, onChange?: (id: string) => void): Promise<AndroidMenuResult> {
  // Stay inside the bridge envelope limit; large command lists keep the web UI.
  if (JSON.stringify(menu).length > 14000) return { status: 'unavailable' }
  try {
    const result = await call('actionMenu', menu, onChange) as AndroidMenuResult | null
    if (result?.status === 'dismissed' || (result?.status === 'selected' && typeof result.id === 'string')) return result
  } catch { /* Unsupported hosts and invalid menus retain their web presentation. */ }
  return { status: 'unavailable' }
}

export async function androidUpdateActionMenu(menu: AndroidActionMenu): Promise<boolean> {
  if (JSON.stringify(menu).length > 14000) return false
  try { return await call('updateActionMenu', menu) === true } catch { return false }
}

export async function androidDismissActionMenu(id: string): Promise<void> {
  try { await call('dismissActionMenu', { id }) } catch { /* A closed page may no longer have a host. */ }
}

export async function androidWebState(ready: boolean, revision: string): Promise<void> {
  if (!isAndroidApp()) return
  const host = await androidHost()
  if (!host?.capabilities.includes('web-state')) return
  let serverProtocol: number | string = 'Unavailable'
  try {
    const response = await fetch('/api/athena/android/capabilities', {
      credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(6000)
    })
    if (response.ok) {
      const server = await response.json() as { protocol?: number }
      serverProtocol = server.protocol ?? 'Unsupported'
    }
  } catch { /* Old servers remain usable, with compatibility visible in diagnostics. */ }
  try { await call('webState', { ready, revision, serverProtocol }) } catch { /* Native recovery stays available. */ }
}

let visibleSession: string | null = null
export function androidVisibleSession(): string | null { return visibleSession }
export async function androidWebVisibility(sessionId: string | null, connected = false): Promise<void> {
  visibleSession = sessionId
  if (!isAndroidApp()) return
  const host = await androidHost()
  if (!host?.capabilities.includes('web-visibility')) return
  try { await call('webVisibility', { sessionId: sessionId || '', connected }) } catch { /* Expiring native leases restore alerts. */ }
}

export async function androidPushDiagnostics(status: string): Promise<void> {
  const host = await androidHost()
  if (!host?.capabilities.includes('push-diagnostics')) return
  try { await call('pushDiagnostics', { status }) } catch { /* Keep diagnostics optional for older APKs. */ }
}
