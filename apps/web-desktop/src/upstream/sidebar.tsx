import type { PointerEvent, RefObject } from 'react'
import type { useSensors } from '@dnd-kit/core'
import type { ChatSidebarProps } from '@/app/chat/sidebar'
import type { SidebarNavItem } from '@/app/types'
import type { AppView } from '@/app/routes'
import type { DesktopConnectionsRegistry, HermesGitWorktree } from '@/global'
import type { SessionInfo } from '@/hermes'
import type { Translations } from '@/i18n'
import type { SidebarProjectTree, SidebarSessionGroup } from '@/app/chat/sidebar/projects'
import type { $cronJobs } from '@/store/cron'
import type { SidebarGrouping } from '@/store/layout'
import { PlatformAvatar } from '@/app/messaging/platform-icon'
import { SidebarSessionsSection } from '@/app/chat/sidebar/sessions-section'
import { SidebarCronJobsSection } from '@/app/chat/sidebar/cron-jobs-section'
import { SidebarLoadMoreRow } from '@/app/chat/sidebar/load-more-row'
import { SidebarSectionAddButton } from '@/app/chat/sidebar/chrome'
import { SidebarFilterMenu } from '@/app/chat/sidebar/filter-menu'
import { SidebarBlankState, SidebarLoadErrorState, SidebarPinnedEmptyState, SidebarSessionSkeletons, SidebarStorageCorruptNotice } from '@/app/chat/sidebar/section-states'
import { ProjectBackRow, ProjectMenu, StartWorkButton } from '@/app/chat/sidebar/projects'
import { ProjectDialog } from '@/app/chat/sidebar/project-dialog'
import { WorktreeDialog } from '@/app/chat/sidebar/projects/worktree-dialog'
import { ProfileRail } from '@/app/chat/sidebar/profile-switcher'
import { buildGatewaySessionGroups, scopeGatewaySessionGroups } from '@/app/chat/sidebar/gateway-group-model'
import { startNewSessionDrag } from '@/app/chat/new-session-drag'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { recordAction } from '@/store/desktop-metrics'
import { pinSession, unpinSession, setSidebarPinsOpen, setSidebarRecentsOpen, toggleSidebarMessagingOpen, setSidebarCronOpen } from '@/store/layout'
import { $newChatProfile } from '@/store/profile'
import { exitProjectScope } from '@/store/project-scope'
import { $newProjectDropPlacement, openProjectCreate } from '@/store/projects'
import { markAllSessionsRead } from '@/store/session'
import { ackAllSessionsRead } from '@/store/session-unread'
import { BrowserSidebar, type BrowserSidebarModel } from '../experience/sidebar'

interface MessagingSection { sourceId: string; label: string; sessions: SessionInfo[]; total: number; hasMore: boolean }
interface SidebarController extends Pick<ChatSidebarProps, 'onNavigate' | 'onResumeSession' | 'onDeleteSession' | 'onArchiveSession' | 'onBranchSession' | 'onNewSessionInWorkspace' | 'onNewSessionSplit' | 'onRetrySessions' | 'onManageCronJob' | 'onTriggerCronJob'> {
  labels: Translations['sidebar']
  navItems: SidebarNavItem[]
  pathname: string
  currentView: AppView
  panesFlipped: boolean
  showSessionSections: boolean
  searchQuery: string
  setSearchQuery(value: string): void
  searchInputRef: RefObject<HTMLInputElement | null>
  trimmedQuery: string
  searchPending: boolean
  searchResults: SessionInfo[]
  activeSidebarSessionId: string | null
  showAllProfiles: boolean
  cardRows: boolean
  dndSensors: ReturnType<typeof useSensors>
  pinnedSessions: SessionInfo[]
  pinsOpen: boolean
  agentsOpen: boolean
  cronOpen: boolean
  inProject: boolean
  enteredProjectId?: string
  projectLoadFailed: boolean
  projectLoading: boolean
  retryProject(): void
  showSessionSkeletons: boolean
  sessionsLoadError: boolean
  filtersActive: boolean
  filtersNarrow: boolean
  sessionsLoading: boolean
  recentsLoadMorePending: boolean
  hasMoreSessions: boolean
  rankedGlobally: boolean
  grouping: SidebarGrouping
  displayAgentGroups?: SidebarSessionGroup[]
  worktreeGroupingActive: boolean
  reposScanning: boolean
  projectsSkeletonVisible: boolean
  enteredProject?: SidebarProjectTree
  activeProjectId: string | null
  enteredProjectOverlaySessions: SessionInfo[]
  agentOrderManual: boolean
  agentOrderIds: string[]
  sortOrderIds: string[]
  projectOverview?: SidebarProjectTree[]
  overviewHidden: { isHidden(session: SessionInfo): boolean; counts: Record<string, number> }
  overviewPreviews: Record<string, SessionInfo[]>
  scopedRepoWorktrees: Record<string, HermesGitWorktree[]>
  enteredProjectContent?: SidebarProjectTree
  projectTreeLoading: boolean
  removedSessionIds: Set<string>
  displayAgentSessions: SessionInfo[]
  agentSessions: SessionInfo[]
  recentsVirtualizes: boolean
  sessionsMode: string
  sessionsLabel: string
  messagingGroups: MessagingSection[]
  messagingVisible: Record<string, number>
  ownerGrouped: boolean
  connectionsRegistry: DesktopConnectionsRegistry | null
  profileColors: Record<string, string>
  messagingLoadMorePending: Record<string, boolean>
  messagingOpenIds: string[]
  cronJobs: ReturnType<typeof $cronJobs.get>
  profileRailVisible: boolean
  unreadCount: number
  toggleUnread(id: string): void
  reorderPinned(ids: string[]): void
  reorderSessions(ids: string[]): void
  reorderProjects(ids: string[]): void
  onLoadMoreRecents(): Promise<void>
  onEnterProject(id: string): void
  revealMoreMessaging(platform: string, loaded: number, hasMore: boolean): void
}

const scroll = 'overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-fade'
const compactFlat = 'compact:max-h-none compact:overflow-visible'
const headerButton = 'text-(--ui-text-tertiary) opacity-0 hover:bg-(--ui-control-hover-background) hover:text-foreground group-hover/section:opacity-100 focus-visible:opacity-100'

/** Only view composition crosses this boundary; the upstream controller owns every query and cache. */
export function BrowserSidebarControllerSurface({ model: c }: { model: SidebarController }) {
  const s = c.labels
  const shared = {
    activeSessionId: c.activeSidebarSessionId, onArchiveSession: c.onArchiveSession, onBranchSession: c.onBranchSession,
    onDeleteSession: c.onDeleteSession, onResumeSession: c.onResumeSession, onToggleUnread: c.toggleUnread
  }
  const navigation = c.navItems.filter(item => item.id !== 'capabilities').map(item => ({
    id: item.id, label: s.nav[item.id] ?? item.label, icon: <item.icon className="size-4 shrink-0 text-[color-mix(in_srgb,currentColor_72%,transparent)]" />,
    active: (['messaging', 'artifacts', 'cron'].includes(item.id) && c.currentView === item.id) ||
      (c.currentView === 'extension' && Boolean(item.route) && c.pathname === item.route), disabled: !item.action && !item.route,
    run: () => { if (item.id === 'new-session') $newChatProfile.set(null); if (item.keybindActionId) recordAction(item.keybindActionId, 'click'); c.onNavigate(item) },
    pointerDown: item.id === 'new-session' ? (event: PointerEvent<HTMLButtonElement>) => startNewSessionDrag(placement => {
      $newChatProfile.set(null); c.onNewSessionSplit(placement.dir, { anchor: placement.anchor, before: placement.before })
    }, event) : undefined
  }))
  const model: BrowserSidebarModel = {
    navigation, flipped: c.panesFlipped, showNewSession: c.grouping !== 'profile', showSections: c.showSessionSections,
    search: { value: c.searchQuery, change: c.setSearchQuery, input: c.searchInputRef }, mode: c.sessionsMode,
    project: c.inProject ? c.enteredProjectId : undefined, notice: <SidebarStorageCorruptNotice />,
    empty: <SidebarBlankState onNewProject={openProjectCreate} />,
    profileRail: c.profileRailVisible ? <div className="shrink-0 px-0.5 pb-1 pt-0.5"><ProfileRail /></div> : null,
    dialogs: <><ProjectDialog /><WorktreeDialog /></>
  }
  const controls = <div className="flex shrink-0 items-center gap-0.5">
    {c.unreadCount > 0 && <Tip label={s.markAllRead}><Button aria-label={s.markAllRead} className={headerButton} size="icon-xs" variant="ghost"
      onClick={event => { event.stopPropagation(); markAllSessionsRead(); ackAllSessionsRead() }}><Codicon name="check-all" size="0.75rem" /></Button></Tip>}
    {c.inProject && c.enteredProject ? <div className="group/workspace flex shrink-0 items-center gap-0.5">
      {c.enteredProject.path && <StartWorkButton project={c.enteredProject} />}
      {!c.enteredProject.isNoProject && <ProjectMenu isActive={c.enteredProject.id === c.activeProjectId} onExitScope={exitProjectScope} project={c.enteredProject} scoped />}
      <div className="grid size-6 place-items-center"><Tip label={s.showProjects}><Button aria-label={s.showProjects} className={headerButton} size="icon-xs" variant="ghost"
        onClick={event => { event.stopPropagation(); exitProjectScope() }}><Codicon name="list-unordered" size="0.75rem" /></Button></Tip></div>
    </div> : <>
      {c.grouping !== 'profile' && <SidebarSectionAddButton ariaLabel={c.grouping === 'project' ? s.projects.newButton : s.nav['new-session']}
        onNewProjectDrag={c.grouping === 'project' ? { onArm: placement => $newProjectDropPlacement.set(placement) } : undefined}
        onNewSessionSplit={c.grouping === 'project' ? undefined : c.onNewSessionSplit}
        onPlainClick={() => c.grouping === 'project' ? openProjectCreate() : c.onNewSessionInWorkspace(null)} />}
      <div className="grid size-6 place-items-center"><SidebarFilterMenu className={headerButton} /></div>
    </>}
  </div>
  return <BrowserSidebar model={model}>
    {c.trimmedQuery ? <SidebarSessionsSection {...shared} browserSectionId="sessions" label={s.results} open onToggle={() => {}} pinned={false}
      onTogglePin={pinSession} sessions={c.searchResults} showProfileTags={c.showAllProfiles} preserveOrder
      rootClassName="browser-session-list-section min-h-32 flex-1 overflow-hidden p-0" contentClassName={cn('flex min-h-0 flex-1 flex-col gap-px pb-1.75', scroll)}
      emptyState={c.searchPending ? <SidebarSessionSkeletons /> : <div className="wrap-anywhere grid min-h-24 place-items-center rounded-lg px-2 text-center text-xs text-(--ui-text-tertiary)">{s.noMatch(c.trimmedQuery)}</div>} /> : <>
      {c.pinnedSessions.length > 0 && <SidebarSessionsSection {...shared} browserSectionId="pinned" label={s.pinned} pinned open={c.pinsOpen}
        onToggle={() => setSidebarPinsOpen(!c.pinsOpen)} onTogglePin={unpinSession} sessions={c.pinnedSessions} card={c.cardRows}
        dndSensors={c.dndSensors} onReorderSessions={c.reorderPinned} sortable={c.pinnedSessions.length > 1} showProfileTags={c.showAllProfiles}
        rootClassName="browser-pinned-section shrink-0 p-0 pb-1" contentClassName="flex flex-col gap-px rounded-lg pb-2 pt-1"
        emptyState={<SidebarPinnedEmptyState archived={c.sessionsMode === 'archived'} filtered={c.filtersNarrow} />} />}
      {c.inProject && c.projectLoadFailed && <SidebarLoadErrorState onRetry={c.retryProject} />}
      <SidebarSessionsSection {...shared} browserSectionId="sessions" label={c.grouping === 'profile' ? 'Profiles' : c.sessionsLabel}
        open={c.agentsOpen} onToggle={() => setSidebarRecentsOpen(!c.agentsOpen)} pinned={false} onTogglePin={pinSession}
        card={c.cardRows} collapsible={!c.inProject} dndSensors={c.dndSensors} activeProjectId={c.activeProjectId}
        contentClassName={cn('flex min-h-0 flex-1 flex-col gap-px pb-1.75', scroll, !c.recentsVirtualizes && compactFlat)}
        rootClassName={cn('browser-session-list-section min-h-32 flex-1 overflow-hidden p-0', !c.recentsVirtualizes && 'compact:min-h-0 compact:flex-none compact:overflow-visible')}
        emptyState={c.inProject && c.projectLoadFailed ? null : c.showSessionSkeletons || (c.inProject && c.projectLoading) ? <SidebarSessionSkeletons /> :
          !c.inProject && c.sessionsLoadError ? <SidebarLoadErrorState onRetry={() => void c.onRetrySessions()} /> :
          <div className="grid min-h-16 place-items-center rounded-lg px-2 text-center text-xs text-(--ui-text-tertiary)">{c.inProject ? s.projectEmpty : c.filtersActive ? s.noFilterMatches : c.pinnedSessions.length ? s.allPinned : s.noSessions}</div>}
        footer={c.grouping !== 'project' && !c.showSessionSkeletons && c.hasMoreSessions ? <SidebarLoadMoreRow loading={c.sessionsLoading || c.recentsLoadMorePending} onClick={() => void c.onLoadMoreRecents()} step={0} /> : null}
        forceEmptyState={c.showSessionSkeletons && !c.displayAgentGroups?.length}
        grouping={c.grouping === 'none' || c.sessionsMode === 'archived' || c.rankedGlobally ? 'none' : c.grouping === 'status' ? 'status' : 'date'}
        groups={c.displayAgentGroups} headerAction={controls} labelMeta={c.worktreeGroupingActive && c.reposScanning && !c.projectsSkeletonVisible ? <GlyphSpinner ariaLabel={s.loading} className="text-[0.6875rem] text-(--ui-text-quaternary)" /> : undefined}
        liveSessions={c.inProject ? c.enteredProjectOverlaySessions : undefined} manualOrderIds={c.agentOrderManual ? c.agentOrderIds : c.sortOrderIds}
        onEnterProject={c.onEnterProject} onNewSessionInWorkspace={c.onNewSessionInWorkspace} onNewSessionSplit={c.onNewSessionSplit}
        onReorderProjects={c.showAllProfiles ? undefined : c.reorderProjects} onReorderSessions={c.reorderSessions}
        projectBackRow={c.inProject ? <ProjectBackRow label={s.projects.back} onClick={exitProjectScope} /> : undefined}
        projectContent={c.inProject ? c.enteredProjectContent : undefined} projectOverview={c.projectOverview}
        projectOverviewHidden={c.overviewHidden} projectOverviewPreviews={c.overviewPreviews} projectRepoWorktrees={c.inProject ? c.scopedRepoWorktrees : undefined}
        projectsLoading={c.worktreeGroupingActive ? c.projectTreeLoading : false} removedSessionIds={c.inProject ? c.removedSessionIds : undefined}
        sessions={c.displayAgentSessions} sortable={c.agentSessions.length > 1} />
      {c.messagingGroups.map(group => {
        const visible = c.messagingVisible[group.sourceId] ?? 3, sessions = group.sessions.slice(0, visible)
        const groups = c.ownerGrouped ? scopeGatewaySessionGroups(buildGatewaySessionGroups(sessions, c.connectionsRegistry, c.profileColors), `messaging:${group.sourceId}`) : undefined
        return <SidebarSessionsSection {...shared} key={group.sourceId} browserSectionId={`messaging:${group.sourceId}`} label={group.label}
          open={c.messagingOpenIds.includes(group.sourceId)} onToggle={() => toggleSidebarMessagingOpen(group.sourceId)} pinned={false} onTogglePin={pinSession}
          sessions={sessions} groups={groups} embeddedGroups showProfileTags={c.showAllProfiles && !c.ownerGrouped}
          rootClassName="shrink-0 p-0" contentClassName={cn('flex max-h-56 flex-col gap-px pb-1.75', scroll, compactFlat)} emptyState={null}
          labelIcon={<PlatformAvatar className="size-4 rounded-[4px] text-[0.5625rem] [&_svg]:size-3" platformId={group.sourceId} platformName={group.label} />}
          footer={visible < group.sessions.length || group.hasMore ? <SidebarLoadMoreRow loading={Boolean(c.messagingLoadMorePending[group.sourceId])}
            onClick={() => c.revealMoreMessaging(group.sourceId, group.sessions.length, group.hasMore)} step={Math.min(10, Math.max(0, group.total - sessions.length))} /> : null} />
      })}
      {!c.worktreeGroupingActive && c.cronJobs.length > 0 && <SidebarCronJobsSection jobs={c.cronJobs} label={s.cronJobs} onManageJob={c.onManageCronJob}
        onOpenRun={c.onResumeSession} onToggle={() => setSidebarCronOpen(!c.cronOpen)} onTriggerJob={c.onTriggerCronJob} open={c.cronOpen} />}
    </>}
  </BrowserSidebar>
}
