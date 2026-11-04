import type { ReactNode } from 'react'
import { WEB_CONNECTION_ID } from '../platform/connection'
import type { AgentProfileRoute } from '@/store/profile'
import type { SessionInfo } from '@/hermes'
import type { NewSessionSplitHandler } from '@/app/chat/new-session-drag'
import { SidebarWorkspaceGroup, type SidebarProjectTree, type SidebarSessionGroup } from '@/app/chat/sidebar/projects'

/** Use the backend's project membership, scoped to the rows of one profile. */
export function browserProfileProjectGroups(sessions: SessionInfo[], projects: SidebarProjectTree[]): (SidebarSessionGroup & { projectId?: string })[] {
  const owner = sessions[0]
  if (!owner) return []
  const remaining = new Set(sessions)
  const groups: (SidebarSessionGroup & { projectId?: string })[] = []
  for (const project of projects.filter(project => !project.isNoProject)) {
    const members = new Set(project.sessionIds ?? [
      ...(project.previewSessions ?? []), ...project.repos.flatMap(repo => repo.groups.flatMap(group => group.sessions))
    ].map(session => session.id))
    const rows = sessions.filter(session => remaining.has(session) && members.has(session.id))
    if (!rows.length) continue
    rows.forEach(session => remaining.delete(session))
    groups.push({ id: JSON.stringify(['profile-project', owner.connection_id, owner.profile, project.id]),
      projectId: project.id, label: project.label, path: project.path, sessions: rows, mode: 'workspace' })
  }
  const home = projects.find(project => project.isNoProject)
  if (remaining.size) groups.unshift({ id: JSON.stringify(['profile-project', owner.connection_id, owner.profile, 'home']),
    projectId: home?.id, label: home?.label ?? 'Home', path: null, sessions: [...remaining], mode: 'workspace' })
  return groups
}

export function BrowserProfileProjects({ sessions, projects, renderRows, onNewSession, onNewSessionSplit }: {
  sessions: SessionInfo[]; projects: SidebarProjectTree[]; renderRows(items: SessionInfo[]): ReactNode
  onNewSession?(path: string | null, owner?: AgentProfileRoute): void
  onNewSessionSplit?: NewSessionSplitHandler
}) {
  const owner = sessions[0] ? { connectionId: sessions[0].connection_id ?? WEB_CONNECTION_ID, profile: sessions[0].profile ?? 'default' } : undefined
  return browserProfileProjectGroups(sessions, projects).map(group => <div key={group.id} data-sessions-project={group.projectId}><SidebarWorkspaceGroup group={group} renderRows={renderRows} onNewSession={onNewSession ? path => onNewSession(path, owner) : undefined}
    onNewSessionSplit={onNewSessionSplit ? (dir, options) => onNewSessionSplit(dir, { ...options, profile: sessions[0]?.profile,
      route: owner }) : undefined} /></div>)
}
