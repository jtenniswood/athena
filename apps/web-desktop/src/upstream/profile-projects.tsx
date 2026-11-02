import { useStore } from '@nanostores/react'
import { useState, type ReactNode } from 'react'
import type { SessionInfo } from '@/hermes'
import { $projects, $projectTree, $projectOwnerBySessionId } from '@/store/projects'
import { $sidebarShowAllSessions } from '@/store/layout'
import { useRevealedRows, SIDEBAR_GROUP_PAGE } from '@/app/chat/sidebar/projects/model'
import { WorkspaceShowMoreButton } from '@/app/chat/sidebar/projects/workspace-header'
import { liveSessionProjectId } from '@/app/chat/sidebar/projects/workspace-groups'
import { SidebarGroupRow, SidebarRowLink } from '@/app/chat/sidebar/chrome'
import { Codicon } from './browser-api'
import { useBrowserPreference } from '../platform/preferences'

/** Group only the supplied profile's rows; upstream still owns session state and actions. */
export function BrowserProfileProjectRows({ sessions, renderRows }: {
  sessions: SessionInfo[]
  renderRows: (sessions: SessionInfo[]) => ReactNode
}) {
  const enabled = useBrowserPreference('presentationMode')
  const grouping = useBrowserPreference('presentationGrouping')
  const projects = useStore($projects)
  const tree = useStore($projectTree)
  const owners = useStore($projectOwnerBySessionId)
  if (!enabled || grouping !== 'project') return <>{renderRows(sessions)}</>
  const groups = new Map<string, { label: string; sessions: SessionInfo[] }>()
  for (const session of sessions) {
    const id = liveSessionProjectId(session, projects, owners) ?? '__no_project__'
    let group = groups.get(id)
    if (!group) {
      const label = id === '__no_project__' ? 'Other chats'
        : tree.find(project => project.id === id)?.label ?? projects.find(project => project.id === id)?.name
          ?? id.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? id
      group = { label, sessions: [] }
      groups.set(id, group)
    }
    group.sessions.push(session)
  }
  return <div className="ml-3 border-l border-border/50 pl-1">
    {[...groups].map(([id, group]) => <ProfileProjectGroup key={id} label={group.label} sessions={group.sessions} renderRows={renderRows} />)}
  </div>
}

function ProfileProjectGroup({ label, sessions, renderRows }: {
  label: string
  sessions: SessionInfo[]
  renderRows: (sessions: SessionInfo[]) => ReactNode
}) {
  const [open, setOpen] = useState(true)
  const showAll = useStore($sidebarShowAllSessions)
  const page = useRevealedRows(sessions, SIDEBAR_GROUP_PAGE)
  const toggle = () => setOpen(value => !value)
  return <div data-browser-profile-project={label}>
    <SidebarGroupRow
      label={<SidebarRowLink aria-expanded={open} onClick={toggle}>{label}</SidebarRowLink>}
      lead={<Codicon name="folder" size="0.8125rem" />}
      toggle={{ ariaLabel: `${open ? 'Collapse' : 'Expand'} ${label}`, onToggle: toggle, open }}
    />
    {open && <>
      {renderRows(showAll ? sessions : page.shown)}
      {!showAll && page.more > 0 && <WorkspaceShowMoreButton count={page.more} label={label} onClick={page.showMore} />}
    </>}
  </div>
}
