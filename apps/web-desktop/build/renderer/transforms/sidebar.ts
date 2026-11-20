import path from 'node:path'
import { projectRendererController } from '../controller'
import { replaceBrowserContract } from './contract'

export function useBrowserSidebarController(source: string, root: string): string {
  if (source.includes("import { ChatSidebarPresentationContext } from './presentation'")) {
    const adapter = JSON.stringify(path.join(root, 'src/upstream/sidebar'))
    const controller = replaceBrowserContract(source, [['export function ChatSidebar(', 'function HermesChatSidebar(']])
    return `import { useBrowserSidebarPresentation } from ${adapter}
` + controller + `
export function ChatSidebar(props: ChatSidebarProps) {
  const presentation = useBrowserSidebarPresentation()
  return <ChatSidebarPresentationContext.Provider value={presentation}>
    <HermesChatSidebar {...props} />
  </ChatSidebarPresentationContext.Provider>
}
`
  }
  source = replaceBrowserContract(source, [
    ["  const ownerGrouped = profileScope === ALL_PROFILES && grouping === 'profile'", "  const ownerGrouped = profileScope === ALL_PROFILES"],
    ['const profileGroups = useGatewaySessionGroups(agentSessions, ownerGrouped, filtersNarrow)', 'const profileGroups = useBrowserProfileGroups(useGatewaySessionGroups(agentSessions, ownerGrouped, filtersNarrow))'],
    ['  useEffect(() => {\n    const next = resolveManualSessionOrderIds(', '  useEffect(() => {\n    if (sessionsLoading || showArchived) return\n    const next = resolveManualSessionOrderIds('],
    ['[agentOrderIds, agentOrderManual, unpinnedAgentSessions]', '[agentOrderIds, agentOrderManual, unpinnedAgentSessions, sessionsLoading, showArchived]']
  ])
  const projection = [
    'navItems', 'pathname', 'currentView', 'panesFlipped', 'showSessionSections',
    'searchQuery', 'setSearchQuery', 'searchInputRef', 'trimmedQuery', 'searchPending', 'searchResults',
    'activeSidebarSessionId', 'showAllProfiles', 'cardRows', 'dndSensors', 'pinnedSessions', 'pinsOpen', 'agentsOpen', 'cronOpen',
    'inProject', 'enteredProjectId', 'projectLoadFailed', 'projectLoading', 'retryProject', 'showSessionSkeletons',
    'sessionsLoadError', 'filtersNarrow', 'sessionsLoading', 'recentsLoadMorePending', 'hasMoreSessions',
    'displayAgentGroups', 'worktreeGroupingActive', 'reposScanning', 'projectsSkeletonVisible',
    'enteredProject', 'activeProjectId', 'enteredProjectOverlaySessions', 'agentOrderIds',
    'projectOverview', 'overviewHidden', 'overviewPreviews', 'scopedRepoWorktrees', 'enteredProjectContent', 'projectTreeLoading',
    'removedSessionIds', 'displayAgentSessions', 'agentSessions', 'recentsVirtualizes', 'sessionsMode', 'sessionsLabel',
    'messagingGroups', 'ownerGrouped', 'connectionsRegistry', 'profileColors', 'messagingLoadMorePending',
    'messagingOpenIds', 'cronJobs', 'profileRailVisible', 'toggleUnread', 'reorderPinned', 'reorderSessions',
    'reorderProjects', 'onLoadMoreRecents', 'onEnterProject', 'loadMoreForMessaging',
    'onNavigate', 'onResumeSession', 'onDeleteSession', 'onArchiveSession', 'onBranchSession', 'onNewSessionInWorkspace',
    'onNewSessionSplit', 'onRetrySessions', 'onManageCronJob', 'onTriggerCronJob'
  ]
  source = projectRendererController(source, 'ChatSidebar', `<BrowserSidebarControllerSurface model={{ labels: s, ${projection.join(', ')} }} />`, ['[messagingVisible, setMessagingVisible]', 'revealMoreMessaging'])
  return `import { BrowserSidebarControllerSurface } from ${JSON.stringify(path.join(root, 'src/upstream/sidebar'))}\n` +
    `import { useBrowserProfileGroups } from ${JSON.stringify(path.join(root, 'src/upstream/profile-groups'))}\n` + source
}

export function useBrowserSessionSection(source: string, root: string): string {
  if (source.includes("import type { SidebarSessionsSectionPresentation } from './section-presentation'")) {
    const adapter = JSON.stringify(path.join(root, 'src/upstream/session-section'))
    const controller = replaceBrowserContract(source, [
      ['export function SidebarSessionsSection(', 'function HermesSidebarSessionsSection(']
    ])
    return `import { browserSessionSectionPresentation } from ${adapter}
` + controller + `
export function SidebarSessionsSection({ browserSectionId, ...props }: SidebarSessionsSectionProps & { browserSectionId?: string }) {
  return <HermesSidebarSessionsSection {...props} sectionId={browserSectionId ?? props.sectionId}
    presentation={browserSessionSectionPresentation} />
}
`
  }
  source = replaceBrowserContract(source, [
    ['interface SidebarSessionsSectionProps {', 'interface SidebarSessionsSectionProps {\n  browserSectionId?: string'],
    ['<ReorderableList ids={sortableRowIds} onReorder={persistSessionOrder} sensors={dndSensors}>\n        {virtual}', '<BrowserSessionReorderList ids={sortableRowIds} onReorder={persistSessionOrder} sensors={dndSensors}>\n        {virtual}'],
    ['<ReorderableList ids={sortableRowIds} onReorder={persistSessionOrder} sensors={dndSensors}>\n        {visibleRows.map', '<BrowserSessionReorderList ids={sortableRowIds} onReorder={persistSessionOrder} sensors={dndSensors}>\n        {visibleRows.map'],
    ['        {virtual}\n      </ReorderableList>', '        {virtual}\n      </BrowserSessionReorderList>'],
    ['        {visibleRows.map(row => renderListRow(row, true, dividerAction))}\n      </ReorderableList>', '        {visibleRows.map(row => renderListRow(row, true, dividerAction))}\n      </BrowserSessionReorderList>'],
    ['export function SidebarSessionsSection({', 'export function SidebarSessionsSection({\n  browserSectionId = \'sessions\',']
  ])
  source = replaceBrowserContract(source, [
    ['<SidebarDateDivider\n          action={action}', '<SidebarDateDivider\n          data-browser-group-header=""\n          action={action && <div data-browser-group-actions="" className="flex shrink-0 items-center">{action}</div>}'],
    ["if (grouping !== 'date' && grouping !== 'status') {", "if (grouping !== 'date' && grouping !== 'status' && !combinedProjects) {"],
    ["$sidebarListGroupIds.set(flatRows.flatMap(row => (row.kind === 'divider' ? [listGroupNodeId(row.key)] : [])))", `$sidebarListGroupIds.set(combinedProjects
      ? (groups ?? []).flatMap(group => browserProfileProjectGroups(group.sessions, projectOverview ?? []).map(project => project.id))
      : (!embeddedGroups && groups?.length
        ? groups.flatMap(group => browserProfileListRows(group.sessions, grouping, dotStates, statusDividerLabels))
        : flatRows).flatMap(row => row.kind === 'divider' ? [listGroupNodeId(row.key)] : []))`],
    ['[flatRows, grouping])', '[flatRows, grouping, embeddedGroups, groups, dotStates, statusDividerLabels, combinedProjects, projectOverview])'],
    ['  const showAllSessions = useStore($sidebarShowAllSessions)', "  const showAllSessions = useStore($sidebarShowAllSessions)\n  const combinedProjects = Boolean(groups?.length && !embeddedGroups && projectOverview)"],
    ['} else if (projectOverview?.length) {', '} else if (projectOverview?.length && !combinedProjects) {'],
    ['        renderRows={renderRows}\n        sensors={dndSensors}', `        renderRows={items => combinedProjects
          ? <BrowserProfileProjects sessions={items} projects={projectOverview ?? []} renderRows={renderRows} activeProjectId={activeProjectId} onEnterProject={onEnterProject} onNewSession={onNewSessionInWorkspace} onNewSessionSplit={onNewSessionSplit} />
          : renderRows(items)}
        sensors={dndSensors}`]
  ])
  source = projectRendererController(source, 'SidebarSessionsSection', `<BrowserSidebarSection model={{
    id: browserSectionId, label, open: sectionOpen, collapsible, toggle: onToggle,
    icon: labelIcon, meta: labelMeta, actions: headerAction, className: rootClassName,
    contentClassName: resolvedContentClassName, pinned
  }} footer={footer}>{inner}</BrowserSidebarSection>`)
  return `import { BrowserSessionReorderList } from ${JSON.stringify(path.join(root, 'src/upstream/session-reorder-list'))}\n` +
    `import { browserProfileListRows } from ${JSON.stringify(path.join(root, 'src/upstream/profile-list-rows'))}\n` +
    `import { BrowserProfileProjects, browserProfileProjectGroups } from ${JSON.stringify(path.join(root, 'src/upstream/profile-projects'))}\n` +
    `import { BrowserSidebarSection } from ${JSON.stringify(path.join(root, 'src/experience/sidebar-section'))}\n` + source
}

export function useBrowserProjectController(source: string, root: string): string {
  if (source.includes("import type { ProjectOverviewPresentation } from './row-presentation'")) {
    const adapter = JSON.stringify(path.join(root, 'src/upstream/sidebar-project'))
    const controller = replaceBrowserContract(source, [['export function ProjectOverviewRow(', 'function HermesProjectOverviewRow(']])
    return `import { BrowserProjectControllerSurface } from ${adapter}
` + controller + `
export function ProjectOverviewRow(props: ProjectOverviewRowProps) {
  return <HermesProjectOverviewRow {...props} presentation={BrowserProjectControllerSurface} />
}
`
  }
  source = replaceBrowserContract(source, [
    ['const recent = fetched.length ? fetched : latestProjectSessions(project, limit)',
      'const recent = previewSessions?.length ? previewSessions : latestProjectSessions(project, Infinity)']
  ])
  source = projectRendererController(source, 'ProjectOverviewRow', `<BrowserProjectControllerSurface ref={ref} style={style} model={{
    project, isActive, open, toggleOpen, onEnter, onNewSession, onNewSessionSplit, newSessionPath,
    rowRef, reorderable, dragging, dragHandleProps, hasRows: recent.length > 0,
    rows: renderRows?.(recent)
  }} />`, ['lead', 'labelLink', 'shell', 'showAllSessions', '[expanded, setExpanded]', '[expanding, setExpanding]',
    'limit', 'fetched', 'visible', 'preview', 'page', 'rows', 'total', 'hiddenCount', 'offerShowAll', 'showAll'])
  return `import { BrowserProjectControllerSurface } from ${JSON.stringify(path.join(root, 'src/upstream/sidebar-project'))}\n` + source
}

export function useBrowserProfileControllers(source: string, root: string): string {
  if (source.includes("import type { ProfileGroupPresentation } from './profile-group-presentation'")) {
    const adapter = JSON.stringify(path.join(root, 'src/upstream/sidebar-profile'))
    const controller = replaceBrowserContract(source, [
      ['export function GatewayProfileGroups(', 'function HermesGatewayProfileGroups(']
    ])
    return `import { useBrowserProfileGroupPresentation } from ${adapter}
` + controller + `
export function GatewayProfileGroups(props: GatewayProfileGroupsProps) {
  const presentation = useBrowserProfileGroupPresentation()
  return <HermesGatewayProfileGroups {...props} presentation={presentation} />
}
`
  }
  source = replaceBrowserContract(source, [
    ['  const items = useContributions(SIDEBAR_PROFILE_GROUP_HEADER_AREA)', "  const items = useContributions(SIDEBAR_PROFILE_GROUP_HEADER_AREA).filter(item => item.id !== 'hermes-bots:screen-portal')"]
  ])
  const gatewaySections = source.indexOf('  const registry = useStore($connectionsRegistry)\n  const order = useStore($gatewayGroupOrder)')
  const groupSorting = source.indexOf('  const ordered = [...sections].sort', gatewaySections)
  if (gatewaySections < 0 || groupSorting < 0) throw new Error('Browser profile group ordering contract changed')
  source = source.slice(0, gatewaySections) + `  const order = useStore($gatewayGroupOrder)
  const sections = [...groups.filter(group => group.connectionId), ...groups.filter(group => !group.connectionId)]

` + source.slice(groupSorting)
  source = projectRendererController(source, 'GatewayProfileGroups', `<BrowserProfileGroupsControllerSurface
    model={{ ids, ordered, sensors }}
    renderGroup={(group, index, onMove) => <GatewayProfileGroup key={group.id} embedded={embedded}
      first={index === 0} last={index === ordered.length - 1} group={group} onMove={onMove}
      onNewSessionSplit={onNewSessionSplit} renderRows={renderRows} />}
  />`)
  source = projectRendererController(source, 'GatewayProfileGroup', `<BrowserProfileGroupControllerSurface model={{
    group, label, open, embedded, first, last, alias: aliases[group.id], sortable, usage,
    renaming, setRenaming, draft, setDraft, onMove, startSession, onNewSessionSplit, route,
    sessions, renderRows, children,
    contribution: group.profile && !embedded ? <ProfileGroupHeaderSlot connectionId={group.connectionId ?? null} profile={group.profile} /> : null
  }} />`, ['[visibleCount, setVisibleCount]', 'hiddenCount'])
  return `import { BrowserProfileGroupsControllerSurface, BrowserProfileGroupControllerSurface } from ${JSON.stringify(path.join(root, 'src/upstream/sidebar-profile'))}\n` + source
}

export function useBrowserWorkspaceController(source: string, root: string): string {
  if (source.includes("import type { WorkspaceGroupPresentation } from './row-presentation'")) {
    const adapter = JSON.stringify(path.join(root, 'src/upstream/sidebar-workspace'))
    const controller = replaceBrowserContract(source, [['export function SidebarWorkspaceGroup(', 'function HermesSidebarWorkspaceGroup(']])
    return `import { BrowserWorkspaceControllerSurface } from ${adapter}
` + controller + `
export function SidebarWorkspaceGroup(props: SidebarWorkspaceGroupProps) {
  return <HermesSidebarWorkspaceGroup {...props} presentation={BrowserWorkspaceControllerSurface} />
}
`
  }
  source = projectRendererController(source, 'SidebarWorkspaceGroup', `<BrowserWorkspaceControllerSurface model={{
    group, isProfileGroup, usage, open, toggleOpen,
    empty: sessions.length === 0, rows: renderRows(sessions), canCreate: Boolean(onNewSession || isProfileGroup),
    handleNewSession, handleNewSessionSplit, onNewSessionSplit, onRemove
  }} />`, ['leadingIcon', 'addButton', 'showAllSessions', 'lane', 'visibleSessions', 'nextCount'])
  return `import { BrowserWorkspaceControllerSurface } from ${JSON.stringify(path.join(root, 'src/upstream/sidebar-workspace'))}\n` + source
}

export function useBrowserWorkspacePresentation(source: string, root: string): string {
  if (source.includes("import type { WorkspaceChromePresentation } from './row-presentation'")) {
    const adapter = JSON.stringify(path.join(root, 'src/upstream/workspace-chrome'))
    const names = ['WorkspaceAddButton', 'WorkspaceShowMoreRow', 'WorkspaceShowMoreButton', 'StartWorkButton', 'WorkspaceHeader']
    const controller = replaceBrowserContract(source, names.map(name => [`export function ${name}(`, `function Hermes${name}(`]))
    const wrappers = names.map(name => `
export function ${name}(props: Parameters<typeof Hermes${name}>[0]) {
  return <Hermes${name} {...props} presentation={browserWorkspaceChromePresentation} />
}
`).join('')
    return `import { browserWorkspaceChromePresentation } from ${adapter}
` + controller + wrappers
  }
  const views: [string, string][] = [
    ['WorkspaceAddButton', '<BrowserTreeAdd label={label} onClick={onClick} onPointerDown={onPointerDown} />'],
    ['WorkspaceShowMoreRow', '<BrowserTreeMore label={label} onClick={onClick} disabled={disabled} />'],
    ['WorkspaceShowMoreButton', '<BrowserTreeMore label={text} onClick={onClick} compact />'],
    ['StartWorkButton', `<BrowserTreeAdd label={p.startWork} icon="git-branch" className="group-hover/section:opacity-100" onClick={() => void openWorktreeDialog({ owner: projectOwnerRoute(project), repoPath: project.path ?? '' })} />`],
    ['WorkspaceHeader', '<BrowserTreeHeader ref={ref} {...rest} model={{ label, title, open, toggle: onToggle, emphasis, icon, actions: action }} />']
  ]
  for (const [name, view] of views) source = projectRendererController(source, name, view)
  return `import { BrowserTreeAdd, BrowserTreeMore, BrowserTreeHeader } from ${JSON.stringify(path.join(root, 'src/experience/sidebar-tree'))}\n` + source
}

export function useBrowserRepositoryController(source: string, root: string): string {
  if (source.includes("import type { RepositoryPresentation } from './row-presentation'")) {
    const adapter = JSON.stringify(path.join(root, 'src/experience/sidebar-tree'))
    const controller = replaceBrowserContract(source, [['export function EnteredProjectContent(', 'function HermesEnteredProjectContent(']])
    return `import { BrowserRepository } from ${adapter}
` + controller + `
export function EnteredProjectContent(props: EnteredProjectContentProps) {
  return <HermesEnteredProjectContent {...props} presentation={BrowserRepository} />
}
`
  }
  source = projectRendererController(source, 'HomeSessions', '<>{renderRows(sessions)}</>', ['home'])
  source = projectRendererController(source, 'RepoFlatSection', `<BrowserRepository model={{
    label: repo.label, title: repo.path ? displayPath(repo.path) : undefined, open, toggle: toggleOpen, emphasis: true,
    icon: <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="repo" size="0.75rem" />,
    actions: onNewSession && <WorkspaceAddButton label={s.newSessionIn(repo.label)} onClick={() => {
      setWorkspaceNodeOpen(repo.id, true)
      onNewSession(repo.path)
    }} onPointerDown={onNewSessionSplit ? event => startNewSessionDrag(placement => {
      setWorkspaceNodeOpen(repo.id, true)
      onNewSessionSplit(placement.dir, { anchor: placement.anchor, before: placement.before, cwd: repo.path })
    }, event, { cwd: repo.path, label: s.newSessionIn(repo.label) }) : undefined} />
  }} dialogs={removeDialog}>{body}</BrowserRepository>`)
  return `import { BrowserRepository } from ${JSON.stringify(path.join(root, 'src/experience/sidebar-tree'))}\n` + source
}

export function useBrowserCronController(source: string, root: string): string {
  if (source.includes("import type { CronSidebarPresentation } from './cron-presentation'")) {
    const adapter = JSON.stringify(path.join(root, 'src/upstream/cron-sidebar-presentation'))
    const controller = replaceBrowserContract(source, [
      ['export function SidebarCronJobsSection(', 'function HermesSidebarCronJobsSection(']
    ])
    return `import { browserCronSidebarPresentation } from ${adapter}
` + controller + `
export function SidebarCronJobsSection(props: SidebarCronJobsSectionProps) {
  return <HermesSidebarCronJobsSection {...props} presentation={browserCronSidebarPresentation} />
}
`
  }
  source = projectRendererController(source, 'SidebarCronJobsSection', `<BrowserSidebarSection model={{
    id: 'cron-jobs', label, open, toggle: onToggle, collapsible: true, pinned: false, acceptsSessionDrops: false,
    className: 'shrink-0 p-0 pb-1',
    contentClassName: 'scrollbar-fade flex max-h-72 flex-col gap-px overflow-x-hidden overflow-y-auto overscroll-contain pb-1.75 compact:max-h-none compact:overflow-visible'
  }}>
    {shown.map(job => <CronJobSidebarRow busy={triggeringJobIds.has(job.id)} expanded={peekJobId === job.id}
      job={job} key={job.id} nowMs={nowMs} onManage={() => onManageJob(job.id)} onOpenRun={onOpenRun}
      onTogglePeek={() => setPeekJobId(prev => prev === job.id ? null : job.id)} onTrigger={() => triggerJob(job.id)} />)}
    {hiddenCount > 0 && <SidebarLoadMoreRow onClick={() => setVisibleCount(count => count + LOAD_MORE_STEP)} step={Math.min(LOAD_MORE_STEP, hiddenCount)} />}
  </BrowserSidebarSection>`)
  source = projectRendererController(source, 'CronJobSidebarRow', `<BrowserCronRow model={{
    label, meta, stateClass: STATE_DOT[state] ?? 'bg-(--ui-text-quaternary)', running: state === 'running', busy, expanded,
    toggleLabel: expanded ? c.hideRuns : c.showRuns, triggerLabel: c.triggerNow, manageLabel: c.manage,
    toggle: onTogglePeek, trigger: onTrigger, manage: onManage,
    wrap: header => <ActionsContextMenu ariaLabel={c.actionsTitle} contentClassName="w-44" items={items}>{header}</ActionsContextMenu>
  }}><CronJobSidebarRuns jobId={job.id} onOpenRun={onOpenRun} /></BrowserCronRow>`)
  source = projectRendererController(source, 'CronJobSidebarRuns', `<BrowserCronRuns loadingLabel={c.loading} emptyLabel={c.noRuns}
    rows={runs === null ? null : runs.map(run => ({ id: run.id, label: formatRunTime(run.last_active || run.started_at),
      selected: run.id === selectedSessionId, open: isCronRunRow(run) ? () => openCronRun(run, onOpenRun) : undefined }))} />`)
  return `import { BrowserSidebarSection } from ${JSON.stringify(path.join(root, 'src/experience/sidebar-section'))}\n` +
    `import { BrowserCronRow, BrowserCronRuns } from ${JSON.stringify(path.join(root, 'src/experience/sidebar-cron'))}\n` + source
}
