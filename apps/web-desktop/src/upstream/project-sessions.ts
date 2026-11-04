import type { SidebarProjectTree } from '@/app/chat/sidebar/projects/workspace-groups'
import { expandedProjectSessions } from '@/app/chat/sidebar/projects/model'
import { hermesApi, type SessionInfo } from '@/hermes'
import { stampRowsWithOwningConnection } from '@/lib/session-owner-stamp'
import { activeGatewayConnectionId } from '@/store/gateway'
import { fetchProjectSessions, projectProfile } from '@/store/projects'

/** Expand the overview without entering a project or changing profile scope. */
export async function fetchBrowserProjectSessions(project: SidebarProjectTree): Promise<SidebarProjectTree | null> {
  if (projectProfile()) return fetchProjectSessions(project.id, { supersedable: false })

  const connectionId = activeGatewayConnectionId()
  // The all-profile endpoint merges projects by folder and stamps each row's
  // profile. Its lanes are summaries; widen its previews to retrieve the rows.
  const limit = Math.max(3, project.sessionCount)
  const result = await hermesApi<{ projects: SidebarProjectTree[]; errors?: unknown[] }>({
    path: `/api/profiles/projects/tree?preview_limit=${limit}&session_limit=${Math.max(2000, limit)}`,
    timeoutMs: 60_000
  })
  if (activeGatewayConnectionId() !== connectionId || projectProfile()) return null
  if (result.errors?.length) throw new Error('Some profiles could not be loaded. Try again.')
  const expanded = result.projects.find(item => item.id === project.id)
  if (!expanded) throw new Error('This project is no longer available. Refresh the session list.')
  return {
    ...expanded,
    previewSessions: expanded.previewSessions ? stampRowsWithOwningConnection(expanded.previewSessions, connectionId) : undefined
  }
}

/** Include REST previews as well as the RPC's hydrated lanes, without duplicates. */
export function browserExpandedProjectSessions(recent: SessionInfo[], project: SidebarProjectTree): SessionInfo[] {
  const seen = new Set<string>()
  return [...expandedProjectSessions(recent, project), ...(project.previewSessions ?? [])].filter(session => {
    if (seen.has(session.id)) return false
    seen.add(session.id)
    return true
  })
}
