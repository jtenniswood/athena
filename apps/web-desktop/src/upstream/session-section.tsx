import type { ComponentProps, ReactNode } from 'react'
import { SidebarDateDivider } from '@/app/chat/sidebar/chrome'
import type { SidebarProjectTree, SidebarSessionGroup } from '@/app/chat/sidebar/projects'
import { BrowserSidebarSection, type BrowserSidebarSectionModel } from '../experience/sidebar-section'
import { browserProfileListRows } from './profile-list-rows'
import { BrowserProfileProjects, browserProfileProjectGroups } from './profile-projects'
import { BrowserSessionReorderList } from './session-reorder-list'

function SessionSectionFrame({ model: { sectionId, ...model }, children, footer }: {
  model: Omit<BrowserSidebarSectionModel, 'id' | 'acceptsSessionDrops'> & { sectionId?: string }
  children: ReactNode
  footer?: ReactNode
}) {
  return <BrowserSidebarSection model={{ ...model, id: sectionId ?? 'sessions' }} footer={footer}>{children}</BrowserSidebarSection>
}

function SessionSectionDivider({ action, ...props }: ComponentProps<typeof SidebarDateDivider>) {
  return <SidebarDateDivider {...props} data-browser-group-header=""
    action={action && <div data-browser-group-actions="" className="flex shrink-0 items-center">{action}</div>} />
}

export const browserSessionSectionPresentation = {
  Section: SessionSectionFrame,
  Divider: SessionSectionDivider,
  SessionReorderList: BrowserSessionReorderList,
  reorderGroupedSessions: true,
  profileRows: browserProfileListRows,
  profileProjects: {
    Render: BrowserProfileProjects,
    ids(groups: SidebarSessionGroup[], projects: SidebarProjectTree[]) {
      return groups.flatMap(group => browserProfileProjectGroups(group.sessions, projects).map(project => project.id))
    }
  }
}
