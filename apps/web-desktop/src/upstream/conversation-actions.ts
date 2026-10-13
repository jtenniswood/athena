import { useStore } from '@nanostores/react'
import { useNavigate } from 'react-router'
import { $selectedStoredSessionId, $sessions, $unreadFinishedSessionIds, markSessionRead, sessionPinId, setSessions } from '@/store/session'
import { ackStoredSessionId } from '@/store/session-unread'
import { renameSessionPreferringRpc } from '@/app/chat/sidebar/session-actions-menu'
import { $activeGatewayProfile } from '@/store/profile'
import { $pinnedSessionIds, pinSession, unpinSession } from '@/store/layout'
import { deleteSession, setSessionArchived } from '@/api/sessions'
import { $unreadWriteGuard, markSessionUnread, pendingUnreadValue } from './browser-unread'
import { reportActionFailure } from '../experience/action-errors'
import type { BrowserSessionActions } from '../experience/contracts/actions'
import type { BrowserConversationModel } from '../experience/contracts/conversation'

/** Commands operate on the displayed session; upstream stores remain authoritative. */
export function useBrowserSessionActions(conversation: BrowserConversationModel): BrowserSessionActions {
  const selected = useStore($selectedStoredSessionId)
  const sessions = useStore($sessions)
  const activeProfile = useStore($activeGatewayProfile)
  const pins = useStore($pinnedSessionIds)
  const finishedUnread = useStore($unreadFinishedSessionIds)
  useStore($unreadWriteGuard)
  const navigate = useNavigate()
  const session = sessions.find(row => String(row.id) === selected)
  const profile = session?.profile || conversation.profile || activeProfile
  const pinId = session ? sessionPinId(session) : selected
  const pinned = Boolean(pinId && pins.includes(pinId))

  const remove = async (action: 'archive' | 'delete') => {
    if (!selected) return
    try {
      const result = action === 'archive'
        ? await setSessionArchived(selected, true, profile)
        : await deleteSession(selected, profile)
      if (!result.ok) throw new Error('Gateway did not confirm the change')
      setSessions(rows => rows.filter(row => row.id !== selected))
      // Completion belongs to this command; a newer selection keeps its route.
      if ($selectedStoredSessionId.get() === selected) navigate('/')
    } catch {
      reportActionFailure(`Could not ${action} conversation.`)
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
      const current = $sessions.get().find(row => row.id === selected)
      if (!current) return
      const persistedUnread = pendingUnreadValue(selected, current.profile) ?? current.unread === true
      const transientUnread = $unreadFinishedSessionIds.get().includes(selected)
      if (persistedUnread || transientUnread) {
        markSessionRead(selected)
        ackStoredSessionId(selected)
      }
      try { if (persistedUnread || !transientUnread) await markSessionUnread(selected, !persistedUnread) }
      catch { reportActionFailure('Could not change unread status.') }
    },
    async rename(title) {
      if (!selected) return false
      const next = title.trim()
      if (next === (session?.title || '').trim()) return true
      try {
        const result = await renameSessionPreferringRpc(selected, next, profile)
        setSessions(rows => rows.map(row => row.id === selected && row.profile === session?.profile
          ? { ...row, title: result.title || next || null } : row))
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
