import { useStore } from '@nanostores/react'
import { useNavigate } from 'react-router'
import { $activeSessionId, $selectedStoredSessionId, $sessionResumeRequest, $sessions, $unreadFinishedSessionIds, applySessionTitle, markSessionRead, sessionPinId, setSessions } from '@/store/session'
import { ackStoredSessionId } from '@/store/session-unread'
import { renameSessionPreferringRpc } from '@/app/chat/sidebar/session-actions-menu'
import { applyRenamedSessionTitle } from '@/store/projects'
import { $activeGatewayProfile } from '@/store/profile'
import { $pinnedSessionIds, pinSession, unpinSession } from '@/store/layout'
import { requestGatewayForAgent } from '@/store/gateway'
import type { SessionOwnerRoute } from '@/store/session-request-router'
import { deleteSession, renameSession, setSessionArchived } from '@/api/sessions'
import { restoreListedSession } from '@/app/session/hooks/use-session-actions/utils'
import { beginSessionMutation, endSessionMutation, tombstoneSessions, untombstoneSessions } from '@/store/session-removal'
import { $unreadWriteGuard, markSessionUnread, pendingUnreadValue } from './browser-unread'
import { reportActionFailure } from '../experience/action-errors'
import { prepareBrowserArchiveUndo } from './archive-undo'
import { confirmAndStopBrowserArchive } from './archive-running'
import type { BrowserSessionActions } from '../experience/contracts/actions'
import type { BrowserConversationModel } from '../experience/contracts/conversation'

/** Retain the displayed owner's runtime for RPC rename, including runtime-only chats. */
async function renameOwnedSession(id: string, title: string, profile: string, runtimeId: string | null, owner?: SessionOwnerRoute) {
  if (!owner) return renameSessionPreferringRpc(id, title, profile)
  if (runtimeId && title) {
    try {
      return await requestGatewayForAgent<{ title?: string }>(owner.connectionId, owner.profile,
        'session.title', { session_id: runtimeId, title, profile: owner.targetProfile || owner.profile })
    } catch { /* Persisted sessions retain the engine's REST fallback. */ }
  }
  return renameSession(id, title, profile)
}

/** Commands operate on the displayed session; upstream stores remain authoritative. */
export function useBrowserSessionActions(conversation: BrowserConversationModel): BrowserSessionActions {
  const selected = useStore($selectedStoredSessionId)
  const sessions = useStore($sessions)
  const runtimeId = useStore($activeSessionId)
  const resume = useStore($sessionResumeRequest)
  const owner = resume?.sessionId === selected ? resume.ownerRoute : undefined
  const activeProfile = useStore($activeGatewayProfile)
  const pins = useStore($pinnedSessionIds)
  const finishedUnread = useStore($unreadFinishedSessionIds)
  useStore($unreadWriteGuard)
  const navigate = useNavigate()
  const profile = conversation.profile || activeProfile
  const matches = (row: { id: string; profile?: string | null }) => String(row.id) === selected && (row.profile || 'default') === profile
  const session = sessions.find(matches)
  const pinId = session ? sessionPinId(session) : selected
  const pinned = Boolean(pinId && pins.includes(pinId))

  const remove = async (action: 'archive' | 'delete') => {
    if (!selected) return
    const offerUndo = action === 'archive' ? prepareBrowserArchiveUndo(selected, profile, session) : undefined
    const archivedIds = [selected, session?.id, session?._lineage_root_id]
    let archiving = false
    try {
      if (action === 'archive' && !await confirmAndStopBrowserArchive(selected, profile, session)) return
      if (action === 'archive') {
        // Stop emits a refresh; keep its older sidebar snapshot from restoring this row.
        tombstoneSessions(archivedIds)
        beginSessionMutation(archivedIds)
        archiving = true
      }
      const result = action === 'archive'
        ? await setSessionArchived(selected, true, profile)
        : await deleteSession(selected, profile)
      if (!result.ok) throw new Error('Gateway did not confirm the change')
      setSessions(rows => rows.filter(row => !matches(row)))
      offerUndo?.()
      // Completion belongs to this command; a newer selection keeps its route.
      if ($selectedStoredSessionId.get() === selected && $sessionResumeRequest.get() === resume) navigate('/')
    } catch {
      if (archiving) {
        untombstoneSessions(archivedIds)
        if (session) restoreListedSession(session)
      }
      reportActionFailure(`Could not ${action} conversation.`)
    } finally {
      if (archiving) endSessionMutation(archivedIds)
    }
  }

  return {
    sessionId: selected,
    title: session?.title || '',
    profile,
    pinned,
    unread: (pendingUnreadValue(selected, session?.profile) ?? session?.unread === true) || Boolean(selected && finishedUnread.includes(selected)),
    togglePin() {
      if (!pinId) return
      if ($pinnedSessionIds.get().includes(pinId)) unpinSession(pinId)
      else pinSession(pinId)
    },
    async toggleUnread() {
      if (!selected) return
      const current = $sessions.get().find(matches)
      if (!current) return
      const persistedUnread = pendingUnreadValue(selected, current.profile) ?? current.unread === true
      const transientUnread = $unreadFinishedSessionIds.get().includes(selected)
      if (persistedUnread || transientUnread) {
        markSessionRead(selected)
        ackStoredSessionId(selected)
      }
      try { if (persistedUnread || !transientUnread) await markSessionUnread(selected, !persistedUnread, profile) }
      catch { reportActionFailure('Could not change unread status.') }
    },
    async rename(title) {
      if (!selected) return false
      const next = title.trim()
      if (next === (session?.title || '').trim()) return true
      try {
        const result = await renameOwnedSession(selected, next, profile, runtimeId, owner)
        applySessionTitle(selected, result.title || next || null, profile)
        applyRenamedSessionTitle(selected, result.title || next || null, profile)
        return true
      } catch {
        reportActionFailure('Could not rename conversation.')
        return false
      }
    },
    archive: () => remove('archive'),
    delete: () => remove('delete')
  }
}
