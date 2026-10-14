import { preferenceKeys, isPreferenceKey, validatePreferenceValues } from '../../../../scripts/preference-schema.mjs'
import { connectionState } from './connection-state'
import { runtimeConfig } from './runtime'
import { registerPendingBrowserWork } from './pending-work'
import { reloadReadinessAfterSaving } from './reload-safety'

type Values = Record<string, string | null>
export type PreferenceSnapshot = { version: 1; accountId: string; revision: number; values: Values }
export type PreferenceSyncStatus = { state: 'loading' | 'saved' | 'saving' | 'offline' | 'account-changed'; remoteChanges: boolean }
type Transport = (body?: { version: 1; accountId: string; seed: boolean; changes: Values }) => Promise<PreferenceSnapshot>
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Local values remain synchronous; the outbox contains only allowlisted preferences. */
export function createPreferenceSync(storage: Store, scope: string, request: Transport, changed: () => void) {
  const ownerKey = `athena.preferences.owner.${scope}`
  let accountId: string | undefined
  let seed: Values = {}
  let pending: Values = {}
  let observed: Values = {}
  let remote: PreferenceSnapshot | undefined
  let running: Promise<void> | undefined
  let status: PreferenceSyncStatus = { state: 'loading', remoteChanges: false }
  const accountChanged = () => status.state === 'account-changed'
  let durable = true
  const local = (): Values => Object.fromEntries(preferenceKeys.map(key => [key, storage.getItem(key)]))
  const outboxKey = () => `athena.preferences.outbox.${scope}.${accountId}`
  const queued = () => Object.keys(seed).length > 0 || Object.keys(pending).length > 0
  const report = (state: PreferenceSyncStatus['state']) => {
    const remoteChanges = !!remote && preferenceKeys.some(key => !Object.hasOwn(pending, key) && !Object.hasOwn(seed, key) &&
      (remote!.values[key] ?? null) !== (observed[key] ?? null))
    status = { state, remoteChanges }
    changed()
  }
  const persist = () => {
    if (!accountId) return
    try {
      if (queued()) {
        const encoded = JSON.stringify({ version: 1, seed, pending })
        storage.setItem(outboxKey(), encoded)
        durable = storage.getItem(outboxKey()) === encoded
      } else { storage.removeItem(outboxKey()); durable = true }
    } catch { durable = false }
  }
  const verify = (snapshot: PreferenceSnapshot) => {
    if (snapshot.version !== 1 || !/^[a-f0-9]{64}$/.test(snapshot.accountId) || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
      throw new Error('Invalid settings response')
    }
    validatePreferenceValues(snapshot.values)
    if (accountId && accountId !== snapshot.accountId) {
      report('account-changed')
      throw new Error('Your signed-in account changed')
    }
    if (!remote || snapshot.revision >= remote.revision) remote = snapshot
  }
  const applyValues = (snapshot: PreferenceSnapshot) => {
    for (const key of preferenceKeys) {
      const value = Object.hasOwn(pending, key) ? pending[key] : Object.hasOwn(seed, key) ? seed[key] : snapshot.values[key] ?? null
      if (value === null) storage.removeItem(key)
      else storage.setItem(key, value)
    }
    observed = local()
  }
  const connect = async (hydrate: boolean) => {
    const snapshot = await request()
    verify(snapshot)
    if (!accountId) {
      const previousOwner = storage.getItem(ownerKey)
      const initial = local()
      accountId = snapshot.accountId
      try {
        const saved = JSON.parse(storage.getItem(outboxKey()) || 'null')
        if (saved?.version === 1) {
          seed = validatePreferenceValues(saved.seed)
          pending = validatePreferenceValues(saved.pending)
        }
      } catch { seed = {}; pending = {} }
      // Only the first account can import unowned legacy settings. Switching
      // accounts never uploads the previous person's local preferences.
      if (snapshot.revision === 0 && (!previousOwner || previousOwner === accountId)) {
        for (const [key, value] of Object.entries(initial)) if (value !== null && !Object.hasOwn(seed, key)) seed[key] = value
      }
      storage.setItem(ownerKey, accountId)
      if (hydrate) applyValues(snapshot)
      else observed = initial
      persist()
    }
    report(queued() ? 'saving' : 'saved')
  }
  const capture = () => {
    if (!accountId || accountChanged()) return false
    try {
      if (storage.getItem(ownerKey) !== accountId) { report('account-changed'); return false }
      const current = local()
      let edited = false
      for (const key of preferenceKeys) {
        if (current[key] !== observed[key]) { pending[key] = current[key]; edited = true }
      }
      observed = current
      if (edited) { persist(); report('saving') }
      return edited
    } catch { report('offline'); return false }
  }
  const flush = (): Promise<void> => {
    if (running) return running
    running = (async () => {
      try {
        if (accountChanged()) return
        if (!accountId) await connect(false)
        capture()
        for (let attempt = 0; queued() && attempt < 8; attempt++) {
          const seeding = Object.keys(seed).length > 0
          const source = seeding ? seed : pending
          const submitted = { ...source }
          const snapshot = await request({ version: 1, accountId: accountId!, seed: seeding, changes: submitted })
          verify(snapshot)
          for (const [key, value] of Object.entries(submitted)) if (source[key] === value) delete source[key]
          persist()
          capture()
        }
        report(queued() ? 'saving' : 'saved')
      } catch (error) {
        if ((error as { accountChanged?: boolean }).accountChanged) report('account-changed')
        else if (!accountChanged()) report('offline')
      }
    })().finally(() => { running = undefined })
    return running
  }
  return {
    status: () => status,
    async initialize() {
      try { await connect(true) } catch {
        try {
          const owner = storage.getItem(ownerKey)
          if (owner && /^[a-f0-9]{64}$/.test(owner)) {
            accountId = owner
            const saved = JSON.parse(storage.getItem(outboxKey()) || 'null')
            if (saved?.version === 1) {
              seed = validatePreferenceValues(saved.seed)
              pending = validatePreferenceValues(saved.pending)
            }
          }
          observed = local()
        } catch { /* Keep the local fallback when storage is unavailable. */ }
        report('offline')
      }
    },
    capture,
    flush,
    async refresh() {
      await flush()
      if (accountChanged()) return
      try { verify(await request()); report(queued() ? 'saving' : 'saved') }
      catch { if (!accountChanged()) report('offline') }
    },
    async prepare() {
      capture()
      await flush()
      return !queued() || durable ? { ready: true as const } : { ready: false as const, reason: 'Your settings could not be saved. Try again before leaving.' }
    },
    async applyRemote(beforeApply?: () => Promise<void>) {
      await flush()
      if (queued()) throw new Error('Save your local settings before applying changes from another device.')
      const snapshot = await request()
      verify(snapshot)
      capture()
      if (queued()) throw new Error('Local settings changed while syncing. Try applying again.')
      await beforeApply?.()
      capture()
      if (queued()) throw new Error('Local settings changed while syncing. Try applying again.')
      applyValues(remote!)
      report('saved')
    }
  }
}

let sync: ReturnType<typeof createPreferenceSync> | undefined
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()
const loading: PreferenceSyncStatus = { state: 'loading', remoteChanges: false }
export const preferenceSyncStatus = () => sync?.status() ?? loading
export const subscribePreferenceSync = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
function announce() { for (const listener of listeners) listener() }

export function capturePreferenceChanges(): void {
  if (!sync?.capture()) return
  clearTimeout(timer)
  timer = setTimeout(() => { void sync?.flush() }, 550)
}

/** Used by wrapper preference writers and the upstream persistence observer. */
export function saveSyncedPreference(key: string, value: string | null, requireLocalSave = false): void {
  if (!isPreferenceKey(key)) throw new Error('This value is not a syncable preference')
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch (error) {
    if (requireLocalSave) throw error
    // Optional display preferences retain their existing best-effort saves.
  }
  capturePreferenceChanges()
}

export async function initializePreferenceSync(): Promise<void> {
  const request: Transport = async body => {
    const headers: Record<string, string> = {}
    const connection = connectionState().load()
    if (connection.authMode === 'token' && connection.token) headers['X-Hermes-Session-Token'] = connection.token
    if (body) headers['Content-Type'] = 'application/json'
    const response = await fetch('/api/athena/preferences', {
      method: body ? 'PATCH' : 'GET', headers, credentials: 'same-origin',
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
      body: body ? JSON.stringify(body) : undefined
    })
    if (!response.ok) throw Object.assign(new Error('Settings sync is unavailable'), { accountChanged: response.status === 409 })
    return response.json()
  }
  const storage: Store = {
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: key => window.localStorage.removeItem(key)
  }
  sync = createPreferenceSync(storage, runtimeConfig().gateway.id, request, announce)
  await sync.initialize()
  void sync.flush()
  registerPendingBrowserWork({ id: 'browser-preferences', prepare: () => sync!.prepare() })
  const refresh = () => { if (!document.hidden) void sync?.refresh() }
  window.addEventListener('online', refresh)
  window.addEventListener('focus', refresh)
  window.addEventListener('storage', capturePreferenceChanges)
  document.addEventListener('visibilitychange', refresh)
  // This also captures renderer preferences that bypass its persistence hook.
  setInterval(capturePreferenceChanges, 2000)
  setInterval(refresh, 30000)
}

export async function applySyncedPreferences(): Promise<void> {
  const root = document.getElementById('root')
  if (!root || root.inert) return
  root.inert = true
  try {
    const state = await reloadReadinessAfterSaving()
    if (!state.ready) throw new Error(state.reason)
    await sync?.applyRemote(async () => {
      const latest = await reloadReadinessAfterSaving()
      if (!latest.ready) throw new Error(latest.reason)
    })
    window.location.reload()
  } catch (error) { root.inert = false; throw error }
}
