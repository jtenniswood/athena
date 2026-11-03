import path from 'node:path'
import { projectRendererController } from '../controller'
import { replaceBrowserContract } from './contract'

export function useBrowserSidebarController(source: string, root: string): string {
  source = replaceBrowserContract(source, [
    ['interface ChatSidebarProps extends', 'export interface ChatSidebarProps extends'],
    ['  const messagingProfile = sidebarProfileForScope(profileScope)', '  const messagingProfile = sidebarProfileForScope(profileScope)\n  useBrowserSidebarChannels()'],
    ['const profileGroups = useGatewaySessionGroups(agentSessions, ownerGrouped, filtersNarrow)', 'const profileGroups = useBrowserProfileGroups(useGatewaySessionGroups(agentSessions, ownerGrouped, filtersNarrow))'],
    ['  const showSessionSections = hasSessionArea({', '  const showSessionSections = Boolean(displayAgentGroups?.length) || hasSessionArea({'],
    ['cronJobs: showsAdvancedChrome ? cronJobs.length : 0,', 'cronJobs: cronJobs.length,'],
    ['  useEffect(() => {\n    const next = resolveManualSessionOrderIds(', '  useEffect(() => {\n    if (sessionsLoading) return\n    const next = resolveManualSessionOrderIds('],
    ['[agentOrderIds, agentOrderManual, unpinnedAgentSessions]', '[agentOrderIds, agentOrderManual, unpinnedAgentSessions, sessionsLoading]']
  ])
  const projection = [
    'navItems', 'pathname', 'currentView', 'panesFlipped', 'showSessionSections',
    'searchQuery', 'setSearchQuery', 'searchInputRef', 'trimmedQuery', 'searchPending', 'searchResults',
    'activeSidebarSessionId', 'showAllProfiles', 'cardRows', 'dndSensors', 'pinnedSessions', 'pinsOpen', 'agentsOpen', 'cronOpen',
    'inProject', 'enteredProjectId', 'projectLoadFailed', 'projectLoading', 'retryProject', 'showSessionSkeletons',
    'sessionsLoadError', 'filtersActive', 'filtersNarrow', 'sessionsLoading', 'recentsLoadMorePending', 'hasMoreSessions',
    'rankedGlobally', 'grouping', 'displayAgentGroups', 'worktreeGroupingActive', 'reposScanning', 'projectsSkeletonVisible',
    'enteredProject', 'activeProjectId', 'enteredProjectOverlaySessions', 'agentOrderManual', 'agentOrderIds', 'sortOrderIds',
    'projectOverview', 'overviewHidden', 'overviewPreviews', 'scopedRepoWorktrees', 'enteredProjectContent', 'projectTreeLoading',
    'removedSessionIds', 'displayAgentSessions', 'agentSessions', 'recentsVirtualizes', 'sessionsMode', 'sessionsLabel',
    'messagingGroups', 'messagingVisible', 'ownerGrouped', 'connectionsRegistry', 'profileColors', 'messagingLoadMorePending',
    'messagingOpenIds', 'cronJobs', 'profileRailVisible', 'unreadCount', 'toggleUnread', 'reorderPinned', 'reorderSessions',
    'reorderProjects', 'onLoadMoreRecents', 'onEnterProject', 'revealMoreMessaging',
    'onNavigate', 'onResumeSession', 'onDeleteSession', 'onArchiveSession', 'onBranchSession', 'onNewSessionInWorkspace',
    'onNewSessionSplit', 'onRetrySessions', 'onManageCronJob', 'onTriggerCronJob'
  ]
  source = projectRendererController(source, 'ChatSidebar', `<BrowserSidebarControllerSurface model={{ labels: s, ${projection.join(', ')} }} />`)
  return `import { BrowserSidebarControllerSurface } from ${JSON.stringify(path.join(root, 'src/upstream/sidebar'))}\n` +
    `import { useBrowserProfileGroups } from ${JSON.stringify(path.join(root, 'src/upstream/profile-groups'))}\n` +
    `import { useBrowserSidebarChannels } from ${JSON.stringify(path.join(root, 'src/experience/sidebar-sections'))}\n` + source
}

export function useBrowserSessionSection(source: string, root: string): string {
  source = replaceBrowserContract(source, [
    ['interface SidebarSessionsSectionProps {', 'interface SidebarSessionsSectionProps {\n  browserSectionId: string'],
    ['export function SidebarSessionsSection({', 'export function SidebarSessionsSection({\n  browserSectionId,']
  ])
  source = projectRendererController(source, 'SidebarSessionsSection', `<BrowserSidebarSection model={{
    id: browserSectionId, label, open: sectionOpen, collapsible, toggle: onToggle,
    icon: labelIcon, meta: labelMeta, actions: headerAction, className: rootClassName,
    contentClassName: resolvedContentClassName, pinned
  }} footer={footer}>{inner}</BrowserSidebarSection>`)
  return `import { BrowserSidebarSection } from ${JSON.stringify(path.join(root, 'src/experience/sidebar-section'))}\n` + source
}

export function useBrowserProjectController(source: string, root: string): string {
  source = replaceBrowserContract(source, [
    ["import { fetchProjectSessions, projectProfile } from '@/store/projects'", "import { notifyError } from '@/store/notifications'"],
    ['  expandedProjectSessions,\n', ''],
    ['expandedProjectSessions(recent, visible)', 'browserExpandedProjectSessions(recent, visible)'],
    [`    // All-profiles view has no single backend to ask for one project's lanes;
    // drilling in is the reach there.
    if (!projectProfile()) {
      onEnter?.(project.id)

      return
    }

    setExpanding(true)
    fetchProjectSessions(project.id, { supersedable: false })`, '    setExpanding(true)\n    fetchBrowserProjectSessions(project)'],
    ['      .catch(() => onEnter?.(project.id))', "      .catch(error => notifyError(error, 'Could not load project sessions'))"]
  ])
  source = projectRendererController(source, 'ProjectOverviewRow', `<BrowserProjectControllerSurface ref={ref} style={style} model={{
    project, isActive, open, toggleOpen, onEnter, onNewSession, onNewSessionSplit, newSessionPath,
    rowRef, reorderable, dragging, dragHandleProps, hasRows: preview.length > 0,
    rows: renderRows?.(rows), offerShowAll, expanding, showAll, total,
    moreCount: expanded ? page.more : 0, showMore: page.showMore
  }} />`, ['lead', 'labelLink', 'shell'])
  return `import { BrowserProjectControllerSurface } from ${JSON.stringify(path.join(root, 'src/upstream/sidebar-project'))}\n` +
    `import { browserExpandedProjectSessions, fetchBrowserProjectSessions } from ${JSON.stringify(path.join(root, 'src/upstream/project-sessions'))}\n` + source
}
