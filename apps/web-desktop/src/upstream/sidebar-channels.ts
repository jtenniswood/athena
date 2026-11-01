import { useStore } from '@nanostores/react'
import { filterSessionsByProfileScope } from '@/app/chat/sidebar/profile-scope'
import { normalizeSessionSource, sessionSourceLabel } from '@/lib/session-source'
import { $profileScope } from '@/store/profile'
import { $messagingSessions } from '@/store/session'

/** Keep controls for existing channels available during search and pinning. */
export function useBrowserSidebarChannels() {
  const sessions = useStore($messagingSessions)
  const profileScope = useStore($profileScope)
  const sources = new Set(filterSessionsByProfileScope(sessions, profileScope)
    .map(session => normalizeSessionSource(session.source)).filter((source): source is string => Boolean(source)))
  return [...sources].map(source => ({ key: `messaging:${source}`, label: sessionSourceLabel(source) ?? source }))
}
