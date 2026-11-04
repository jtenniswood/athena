import { useRef, type ReactNode } from 'react'
import { WEB_CONNECTION_ID } from '../platform/connection'
import type { AgentProfileRoute } from '@/store/profile'
import type { SessionInfo } from '@/hermes'
import type { NewSessionSplitHandler } from '@/app/chat/new-session-drag'
import type { SidebarProjectTree, SidebarSessionGroup } from '@/app/chat/sidebar/projects'
import { useWorkspaceNodeOpen } from '@/app/chat/sidebar/projects/model'
import { BrowserProjectControllerSurface } from './sidebar-project'

type BrowserProfileProjectGroup = SidebarSessionGroup & { project: SidebarProjectTree }

/** Use the backend's project membership, scoped to the rows of one profile. */
export function browserProfileProjectGroups(sessions: SessionInfo[], projects: SidebarProjectTree[]): BrowserProfileProjectGroup[] {
  const owner = sessions[0]
  if (!owner) return []
  const remaining = new Set(sessions)
  const groups: BrowserProfileProjectGroup[] = []
  for (const project of projects.filter(project => !project.isNoProject)) {
    const members = new Set(project.sessionIds ?? [
      ...(project.previewSessions ?? []), ...project.repos.flatMap(repo => repo.groups.flatMap(group => group.sessions))
    ].map(session => session.id))
    const rows = sessions.filter(session => remaining.has(session) && members.has(session.id))
    if (!rows.length) continue
    rows.forEach(session => remaining.delete(session))
    groups.push({ id: JSON.stringify(['profile-project', owner.connection_id, owner.profile, project.id]),
      label: project.label, path: project.path, sessions: rows, mode: 'workspace', project })
  }
  const home = projects.find(project => project.isNoProject)
  if (remaining.size) groups.unshift({ id: JSON.stringify(['profile-project', owner.connection_id, owner.profile, 'home']),
    label: home?.label ?? 'Home', path: null, sessions: [...remaining], mode: 'workspace', isHome: true,
    project: home ?? { id: '__no_project__', label: 'Home', path: null, isNoProject: true, repos: [], sessionCount: remaining.size } })
  return groups
}

interface BrowserProfileProjectsProps {
  sessions: SessionInfo[]; projects: SidebarProjectTree[]; renderRows(items: SessionInfo[]): ReactNode
  activeProjectId?: string | null
  onEnterProject?(id: string): void
  onNewSession?(path: string | null, owner?: AgentProfileRoute): void
  onNewSessionSplit?: NewSessionSplitHandler
}

/** Share project presentation and menus while keeping each profile's disclosure and rows separate. */
export function BrowserProfileProjectRow({ group, renderRows, activeProjectId, onEnterProject, onNewSession, onNewSessionSplit }: {
  group: BrowserProfileProjectGroup
} & Omit<BrowserProfileProjectsProps, 'sessions' | 'projects'>) {
  const [open, toggleOpen] = useWorkspaceNodeOpen(group.id)
  const rowRef = useRef<HTMLDivElement>(null)
  const project = group.project
  return <BrowserProjectControllerSurface model={{
    project, isActive: project.id === activeProjectId, open, toggleOpen, rowRef,
    onEnter: onEnterProject, onNewSession, onNewSessionSplit,
    newSessionPath: project.path || project.repos.find(repo => repo.path)?.path || null,
    reorderable: false, dragging: false, hasRows: group.sessions.length > 0, rows: renderRows(group.sessions)
  }} />
}

export function BrowserProfileProjects({ sessions, projects, renderRows, activeProjectId, onEnterProject, onNewSession, onNewSessionSplit }: BrowserProfileProjectsProps) {
  const owner = sessions[0] ? { connectionId: sessions[0].connection_id ?? WEB_CONNECTION_ID, profile: sessions[0].profile ?? 'default' } : undefined
  return browserProfileProjectGroups(sessions, projects).map(group => <BrowserProfileProjectRow key={group.id} group={group} renderRows={renderRows}
    activeProjectId={activeProjectId} onEnterProject={onEnterProject} onNewSession={onNewSession ? path => onNewSession(path, owner) : undefined}
    onNewSessionSplit={onNewSessionSplit ? (dir, options) => onNewSessionSplit(dir, { ...options, profile: sessions[0]?.profile,
      route: owner }) : undefined} />)
}
