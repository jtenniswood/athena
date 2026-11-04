import { getApiRequestConnection, getApiRequestProfile } from '@/api/client'
import { withSessionNotFoundResume } from '@/app/session/hooks/use-prompt-actions/utils'
import type { SessionInfo } from '@/hermes'
import { requestGatewayForAgent } from '@/store/gateway'
import { $activeSessionId, $busy, $selectedStoredSessionId, $sessions, lineageAliases } from '@/store/session'
import { $sessionDotStateById } from '@/store/session-dot-state'
import { $sessionStates, knownOwnerForSession } from '@/store/session-states'
import { confirmRunningChatArchive } from '../experience/archive-confirmation'

/** Both archive entry points ask before stopping work, without changing selection or drafts. */
export async function confirmAndStopBrowserArchive(id: string, profile?: string | null, session?: SessionInfo): Promise<boolean> {
  const connection = getApiRequestConnection()
  const ownerProfile = profile?.trim() || getApiRequestProfile() || 'default'
  const aliases = new Set(lineageAliases(id, session ? [session] : $sessions.get()))
  const runningRuntime = () => Object.entries($sessionStates.get()).find(([runtime, state]) => {
    if (!aliases.has(state.storedSessionId || runtime) || !(state.busy || state.awaitingResponse || state.needsInput)) return false
    const owner = knownOwnerForSession(runtime)
    return !owner || (typeof owner === 'string' ? owner === ownerProfile
      : owner.profile === ownerProfile && (!session?.connection_id || owner.connectionId === session.connection_id))
  })?.[0]
  const selectedRuntime = () => aliases.has($selectedStoredSessionId.get() || '') && $busy.get() ? $activeSessionId.get() : null
  const isRunning = () => Boolean(runningRuntime() || selectedRuntime() || [...aliases].some(alias =>
    ['working', 'stalled', 'needs-input'].includes($sessionDotStateById.get()[alias])))
  if (!isRunning()) return true

  return confirmRunningChatArchive(async () => {
    if (getApiRequestConnection() !== connection) throw new Error('Return to this chat’s gateway before archiving it.')
    // A response may finish while the dialog is open. Avoid interrupting an idle runtime.
    if (!isRunning()) return
    const request = <T,>(method: string, params?: Record<string, unknown>) =>
      requestGatewayForAgent<T>(session?.connection_id || connection, ownerProfile, method, { ...params, profile: ownerProfile })
    const { result } = await withSessionNotFoundResume(runningRuntime() || selectedRuntime() || id, id,
      runtime => request<{ ok?: boolean }>('session.interrupt', { session_id: runtime }), { requestGateway: request })
    if (result?.ok === false) throw new Error('Could not stop this response. Try again.')
    if (getApiRequestConnection() !== connection) throw new Error('Return to this chat’s gateway before archiving it.')
  })
}
