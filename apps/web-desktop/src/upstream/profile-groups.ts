import { useStore } from '@nanostores/react'
import type { SidebarSessionGroup } from '@/app/chat/sidebar/projects/workspace-groups'
import { resolveProfileColor } from '@/lib/profile-color'
import { $profileColors, $profiles } from '@/store/profile'
import { WEB_CONNECTION_ID } from '../platform/connection'

/** Configured profiles remain entry points even before their first conversation. */
export function useBrowserProfileGroups(groups: SidebarSessionGroup[] | undefined): SidebarSessionGroup[] | undefined {
  const profiles = useStore($profiles)
  const colors = useStore($profileColors)
  if (!groups) return undefined

  const result = [...groups]
  for (const profile of profiles) {
    const id = JSON.stringify([WEB_CONNECTION_ID, profile.name])
    if (result.some(group => group.profile === profile.name && (!group.connectionId || group.connectionId === WEB_CONNECTION_ID))) continue
    result.push({
      id,
      label: profile.name,
      profile: profile.name,
      connectionId: WEB_CONNECTION_ID,
      mode: 'profile',
      path: null,
      color: resolveProfileColor(profile.name, colors),
      sessions: []
    })
  }
  return result.sort((a, b) => (a.profile ?? a.label).localeCompare(b.profile ?? b.label) || a.id.localeCompare(b.id))
}
