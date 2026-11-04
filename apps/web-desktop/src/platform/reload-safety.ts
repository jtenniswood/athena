import { flushPendingBrowserWork } from './pending-work'
import { browserDraftSnapshot, flushBrowserDrafts, type DraftSnapshot } from './draft-safety'

export type { DraftSnapshot } from './draft-safety'

type ReloadPurpose = 'navigation' | 'ui-update'

let activeWork: number | undefined
let operations = 0
let pendingMedia = 0
const tracks = new Set<MediaStreamTrack>()
export function setActiveWork(work: { count: number }): void { activeWork = work.count }
export function beginOperation(): () => void {
  operations++
  let complete = false
  return () => { if (!complete) { complete = true; operations-- } }
}

/** Hold reloads while a media owner is recording or still producing its transcript. */
export function beginMediaOperation(): () => void {
  pendingMedia++
  let complete = false
  return () => { if (!complete) { complete = true; pendingMedia-- } }
}

/** Track the actual browser media lifetime, including permission prompts. */
export function trackMediaRequests(): void {
  const devices = navigator.mediaDevices
  if (!devices?.getUserMedia) return
  const original = devices.getUserMedia.bind(devices)
  devices.getUserMedia = async constraints => {
    const finish = beginMediaOperation()
    try {
      const stream = await original(constraints)
      for (const track of stream.getTracks()) tracks.add(track)
      return stream
    } finally { finish() }
  }
}

export function reloadReadiness(requirePersisted = true, purpose: ReloadPurpose = 'navigation'): { ready: boolean; reason?: string; drafts?: DraftSnapshot } {
  if (activeWork === undefined) return { ready: false, reason: 'Wait for the app to finish connecting.' }
  // A UI update reconnects to the same gateway and resumes its running turns.
  // Navigation may change credentials or servers, so it still waits for work.
  if (activeWork > 0 && purpose !== 'ui-update') return { ready: false, reason: 'Wait for the active response to finish, or cancel it.' }
  if (operations > 0) return { ready: false, reason: 'Finish selecting or uploading files first.' }
  for (const track of tracks) if (track.readyState === 'ended') tracks.delete(track)
  if (pendingMedia || tracks.size) return { ready: false, reason: 'Finish recording or transcribing first.' }
  try {
    const drafts = browserDraftSnapshot()
    if (!drafts) return { ready: false, reason: 'Wait for the app to finish connecting.' }
    if (drafts.blocked) return { ready: false, reason: drafts.reason || 'Finish editing the queued message or leave message history first.' }
    if (drafts.attachments) return { ready: false, reason: 'Send or remove unsent attachments before reloading.' }
    if (!requirePersisted) return { ready: true, drafts }
    const stored = JSON.parse(window.localStorage.getItem(drafts.storageKey) || '{}')
    if (!stored || Object.entries(drafts.texts).some(([key, value]) => stored[key] !== value)) {
      return { ready: false, reason: 'Your text draft could not be saved. Copy it before reloading.' }
    }
    return { ready: true, drafts }
  } catch { return { ready: false, reason: 'Browser storage is unavailable. Copy your draft before reloading.' } }
}

export function assertSafeReload(): void {
  const state = reloadReadiness()
  if (!state.ready) throw new Error(state.reason)
}

/** Flush pending cross-tab saves before promising that activation is safe. */
export async function reloadReadinessAfterSaving(purpose: ReloadPurpose = 'navigation'): Promise<ReturnType<typeof reloadReadiness>> {
  const state = reloadReadiness(false, purpose)
  if (!state.ready) return state
  const pendingWork = await flushPendingBrowserWork()
  if (!pendingWork.ready) return { ready: false, reason: pendingWork.reason }
  try { await flushBrowserDrafts() }
  catch { return { ready: false, reason: 'Your text draft could not be saved. Copy it before reloading.' } }
  // Capture again after the await: activity or composer content may have changed.
  return reloadReadiness(true, purpose)
}

/** Flush cross-tab draft writes before changing the active gateway or credentials. */
export async function assertSafeConnectionChange(): Promise<void> {
  const state = await reloadReadinessAfterSaving()
  if (!state.ready) throw new Error(state.reason)
}
