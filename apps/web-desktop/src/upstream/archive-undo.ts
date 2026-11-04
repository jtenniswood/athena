import { getApiRequestConnection, getApiRequestProfile } from '@/api/client'
import { getSession, setSessionArchived } from '@/api/sessions'
import type { SessionInfo } from '@/hermes'
import { restoreListedSession } from '@/app/session/hooks/use-session-actions/utils'
import { $archivedSessions } from '@/store/sidebar-archive'
import { untombstoneSessions } from '@/store/session-removal'
import { showArchivedChatToast } from '../experience/archive-toast'

/** Capture the archive owner before the request; Undo never follows a newer selection. */
export function prepareBrowserArchiveUndo(id: string, profile?: string | null, session?: SessionInfo): () => void {
  const connection = getApiRequestConnection()
  const ownerProfile = profile?.trim() || getApiRequestProfile() || 'default'
  const snapshot = session ? { ...session } : undefined
  return () => showArchivedChatToast(async () => {
    // A different gateway may contain the same id. Retry after returning to its owner.
    if (getApiRequestConnection() !== connection) throw new Error('Archive gateway is no longer selected')
    const result = await setSessionArchived(id, false, ownerProfile)
    if (!result.ok) throw new Error('Gateway did not confirm the restore')
    const restored = snapshot || await getSession(id, ownerProfile)
    if (getApiRequestConnection() !== connection) return
    untombstoneSessions([id, restored.id, restored._lineage_root_id])
    $archivedSessions.set($archivedSessions.get().filter(row => row.id !== restored.id || row.profile !== restored.profile))
    restoreListedSession({ ...restored, profile: ownerProfile, archived: false, pinned: false })
  })
}
