import { createHash } from 'node:crypto'
import path from 'node:path'
import registry from '../compatibility-registry.json'
import { replaceBrowserContract } from './contract'
const contracts = registry.filter(entry => entry.sourceRoot === 'renderer' && entry.module && entry.sourceHash)
const storageScope = `\n  if (/^hermes\\.desktop\\.(?:layout|pane|sidebar|fileBrowser|rightRail|profileRail|terminal|statusbar|hiddenStrip|dismissedPanes|userPlaced)/.test(key)) key = 'hermes-web.browser.' + key\n`
export function useBrowserPinWrites(source: string, root: string): string {
  const start = source.indexOf('function writePin(')
  const end = source.indexOf('\n/**', start)
  if (start < 0 || end < 0) throw new Error('Browser pin write owner changed')
  const imports = JSON.stringify(path.join(root, 'src/upstream/browser-pin-writes'))
  const write = `let browserPreviousPinOrder: readonly string[] = []

function writePin(id: string, pinned: boolean, profile?: null | string): void {
  const restoreIndex = browserPreviousPinOrder.indexOf(id)
  const confirmed = unconfirmed.get(id)?.value ?? loadedRowFor(id)?.pinned ?? !pinned
  unconfirmed.set(id, { at: Date.now(), value: pinned })
  queueBrowserPinWrite(id, pinned, profile, confirmed, (value, failed) => {
    // Keep the confirmed value ahead of session pages issued before this write.
    unconfirmed.set(id, { at: Date.now(), value })
    if (failed) {
      pending.delete(id)
      if (value) mirrored.add(id)
      else mirrored.delete(id)
      // Mirror bookkeeping is settled before notifying the reconciliation owner.
      if (value) pinSession(id, restoreIndex < 0 ? undefined : restoreIndex)
      else unpinSession(id)
    }
    publishUnconfirmed()
  })
}
`
  const replacements = [
    ["import { setSessionPinnedRemote } from '@/hermes'", `import { hasBrowserPinWrite, queueBrowserPinWrite, resetBrowserPinWrites } from ${imports}`],
    [source.slice(start, end), write],
    ['    if (guard && guardKey) {', '    if (hasBrowserPinWrite(pinId) || hasBrowserPinWrite(row.id)) continue\n\n    if (guard && guardKey) {'],
    ['void writePin(id, false, profileFor(id)).catch(() => {})', 'writePin(id, false, profileFor(id))'],
    [`void writePin(id, true, row.profile).catch(() => {
      // Let a later reconcile retry the mirror.
      mirrored.delete(id)
      pending.add(id)
    })`, 'writePin(id, true, row.profile)'],
    ['$pinnedSessionIds.listen(reconcile)', `$pinnedSessionIds.listen((_ids, previous) => {
    // Capture the removed pin's position before reconciliation queues its unpin.
    browserPreviousPinOrder = previous ?? []
    reconcile()
  })`],
    ['export function resetSessionPinMirror(): void {', 'export function resetSessionPinMirror(): void {\n  browserPreviousPinOrder = []\n  resetBrowserPinWrites()']
  ]
  let output = source
  for (const [before, after] of replacements) {
    if (output.split(before).length !== 2) throw new Error('Browser pin reconciliation contract changed')
    output = output.replace(before, after)
  }
  return output
}

export function useBrowserOpenSessionOwner(source: string, root: string): string {
  const target = 'export function openSession('
  if (source.split(target).length !== 2) throw new Error('Browser session entry point changed')
  const owner = JSON.stringify(path.join(root, 'src/upstream/selection-owner'))
  return `import { runBrowserSessionSelection } from ${owner}\n` + source.replace(target, 'function openEngineSession(') + `
export function openSession(
  storedSessionId: string,
  navigate: OpenSessionNavigate,
  intent: OpenSessionIntent = 'in-place',
  workspaceScope: OpenSessionWorkspaceScope = { workspaceMode: 'sessions' }
): void {
  if (!storedSessionId) return
  const bot = workspaceScope.workspaceMode === 'bots'
  // Browser navigation has one conversation surface, including palette/refs.
  const browserIntent = !bot && ['stack', 'tab', 'window'].includes(intent) ? 'in-place' : intent
  const select = () => openEngineSession(storedSessionId, navigate, browserIntent, workspaceScope)
  // Bot activation owns its existing generation and must not cancel itself.
  if (bot) select()
  else runBrowserSessionSelection(select)
}
`
}

export function useBrowserFreshSessionOwner(source: string, root: string): string {
  const start = '    (options: boolean | FreshSessionDraftOptions = false) => {'
  const end = '      setFreshDraftReady(true)\n    },'
  if (source.split(start).length !== 2 || source.split(end).length !== 2) throw new Error('Browser fresh-session owner changed')
  const owner = JSON.stringify(path.join(root, 'src/upstream/selection-owner'))
  return `import { runBrowserSessionSelection } from ${owner}\n` + source
    .replace(start, start.replace('=> {', '=> runBrowserSessionSelection(() => {'))
    .replace(end, end.replace('    },', '    }),'))
}

export function useBrowserDefaultSessionProfile(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/upstream/default-session-profile'))
  const targets = [
    ['    startFreshSession: startFreshSessionDraft,', '    startFreshSession: () => { prepareDefaultNewSession(); startFreshSessionDraft() },'],
    ['    onNewSessionInWorkspace: (path, owner) => startSessionInWorkspace(path, { owner }),', '    onNewSessionInWorkspace: (path, owner) => { if (!owner) prepareDefaultNewSession(); startSessionInWorkspace(path, { owner }) },']
  ]
  for (const [target, replacement] of targets) {
    if (source.split(target).length !== 2) throw new Error('Browser default new-session profile entry point changed')
    source = source.replace(target, replacement)
  }
  return `import { prepareDefaultNewSession } from ${owner}\n` + source
}

export function keepBrowserWorkspaceRoute(source: string, root: string): string {
  const target = "import { Navigate, Route, Routes, useParams } from 'react-router'"
  if (source.split(target).length !== 2) throw new Error('Browser workspace routes changed')
  const owner = JSON.stringify(path.join(root, 'src/upstream/browser-routes'))
  return source.replace(target, `import { Navigate, Route, useParams } from 'react-router'\nimport { BrowserWorkspaceRoutes as Routes } from ${owner}`)
}

export function useBrowserOverlayFocusOwner(source: string, root: string): string {
  const start = '}: OverlayViewProps) {', element = '    <div\n      className={cn('
  if (source.split(start).length !== 2 || source.split(element).length !== 2) throw new Error('Browser overlay focus owner changed')
  const owner = JSON.stringify(path.join(root, 'src/experience/ui/overlay-focus'))
  const embedded = JSON.stringify(path.join(root, 'src/experience/settings/embedded-overlay'))
  return `import { useSettingsEmbeddedOverlay, BrowserSettingsEmbeddedContent } from ${embedded}\nimport { useBrowserOverlayFocus } from ${owner}\n` + source
    .replace('export function OverlayView({', 'function BrowserStandaloneOverlayView({')
    .concat('\nexport function OverlayView(props: OverlayViewProps) {\n  const embedded = useSettingsEmbeddedOverlay()\n  return embedded ? <BrowserSettingsEmbeddedContent>{props.children}</BrowserSettingsEmbeddedContent> : <BrowserStandaloneOverlayView {...props} />\n}\n')
    .replace(start, start + '\n  const browserOverlayRef = useBrowserOverlayFocus()')
    .replace(element, '    <div\n      ref={browserOverlayRef}\n      tabIndex={-1}\n      className={cn(')
}

export function respectBrowserOverlayFocusReturn(source: string, root: string): string {
  const target = '    if (!inputDisabled && paneVisible && !floating) {'
  if (source.split(target).length !== 2) throw new Error('Browser composer autofocus owner changed')
  const owner = JSON.stringify(path.join(root, 'src/experience/ui/overlay-focus'))
  return `import { browserOverlayOwnsReturnedFocus, browserShouldSkipAutomaticComposerFocus } from ${owner}\n` + source
    .replace(target, '    if (!inputDisabled && paneVisible && !floating && !browserOverlayOwnsReturnedFocus() && !browserShouldSkipAutomaticComposerFocus()) {')
}

export function useBrowserDirectResumeOwner(source: string): string {
  const target = '    resumeStoredSession: resumeSession,'
  if (source.split(target).length !== 2) throw new Error('Browser direct resume owner changed')
  // Navigate first, so the route-resume owner cannot restore the previous route
  // while a typed /resume command loads its chosen conversation.
  return source.replace(target, '    resumeStoredSession: id => openSession(id, navigate),')
}

export function scopeBrowserStorage(source: string): string {
  const original = source.split(storageScope).join('')
  const contract = contracts.find(item => item.module === 'lib/storage.ts')!
  if (createHash('sha256').update(original).digest('hex') !== contract.sourceHash) throw new Error('Browser storage scope no longer matches upstream')
  const targets = ['export function readKey(key: string): null | string {', 'export function writeKey(\n  key: string,\n  value: null | string,\n  { isDefault = false, provisional = false }: WriteOptions = {}\n) {']
  let output = original
  for (const target of targets) {
    if (output.split(target).length !== 2) throw new Error('Browser storage scope no longer matches upstream')
    output = output.replace(target, target + storageScope)
  }
  if (source !== original && source !== output) throw new Error('Browser storage scope was partially modified')
  return output
}

export function filterBrowserNarrowNavigation(source: string): string {
  const before = 'panes.filter(p => paneChrome(p).collapsible && inTree.has(p.id)'
  const after = "panes.filter(p => !['sessions', 'hermes-bots:pane', 'terminal'].includes(p.id) && paneChrome(p).collapsible && inTree.has(p.id)"
  const headerTarget = '          {/* Zone-mates share the overlay'
  const closeHeader = `          <div className="browser-overlay-title">
            <span>{revealed.title ?? revealed.id}</span>
            <button aria-label={\`Close \${revealed.title ?? revealed.id} panel\`} onClick={() => { setReveal(null); closeTabPane(revealed.id) }}>×</button>
          </div>
`
  const replacements = [
    [before, after],
    ['import { $hiddenTreePanes, $layoutTree, $narrowViewport }', 'import { $hiddenTreePanes, $layoutTree, $narrowViewport, closeTabPane }'],
    [headerTarget, closeHeader + headerTarget]
  ]
  let original = source
  for (const [target, replacement] of replacements) original = original.replace(replacement, target)
  const contract = contracts.find(item => item.module?.endsWith('/narrow-overlays.tsx'))!
  if (createHash('sha256').update(original).digest('hex') !== contract.sourceHash) throw new Error('Browser narrow tool overlay contract changed')
  let output = original
  for (const [target, replacement] of replacements) {
    if (output.split(target).length !== 2) throw new Error('Browser narrow tool overlay target changed')
    output = output.replace(target, replacement)
  }
  if (source !== original && source !== output) throw new Error('Browser narrow tool overlay was partially modified')
  return output
}

export function closeBrowserWorkspacePanels(source: string): string {
  // Without a selected project the visibility binding already reads false,
  // so calling the owner's closer cannot emit another false notification.
  // Explicit browser Close must also hide a manually revealed empty panel.
  const before = 'export function closeTreePane(paneId: string) {\n  const closer = paneClosers[paneId]\n\n  if (closer) {\n    closer()'
  const after = before + "\n    if (['files', 'review'].includes(paneId)) setTreePaneHidden(paneId, true)"
  const original = source.replace(after, before)
  const contract = contracts.find(item => item.module === 'components/pane-shell/tree/store.ts')!
  if (createHash('sha256').update(original).digest('hex') !== contract.sourceHash || original.split(before).length !== 2) throw new Error('Browser empty-panel close contract changed')
  return original.replace(before, after)
}

export function exportBrowserStatusbarItem(source: string): string {
  const before = 'const StatusbarItemView = memo(function StatusbarItemView('
  const after = 'export ' + before
  const original = source.replace(after, before)
  const contract = contracts.find(item => item.module === 'app/shell/statusbar-controls.tsx')!
  if (createHash('sha256').update(original).digest('hex') !== contract.sourceHash || original.split(before).length !== 2) throw new Error('Browser statusbar item contract changed')
  return original.replace(before, after)
}

export function removeBrowserNewSessionShortcut(source: string): string {
  const importTarget = "import { KbdGroup } from '@/components/ui/kbd'\n"
  const shortcut = [
    '                    {isNewSession && (',
    '                      <KbdGroup',
    "                        className={cn('ml-auto opacity-55', newSessionKbdFlash && 'opacity-100!')}",
    '                        keys={newSessionKbd}',
    '                        size="sm"',
    '                      />',
    '                    )}'
  ].join('\n') + '\n'
  if (!source.includes('KbdGroup') && !source.includes(importTarget)) return source
  if (source.split(importTarget).length !== 2 || source.split(shortcut).length !== 2) {
    throw new Error('Browser new-session shortcut target changed')
  }
  return source.replace(importTarget, '').replace(shortcut, '')
}

export function removeBrowserTopCapabilitiesLink(source: string): string {
  const replacements = [
    ["  CAPABILITIES_ROUTE,\n", ''],
    [
      "  {\n    id: 'capabilities',\n    label: '',\n    icon: props => <Codicon name=\"symbol-misc\" {...props} />,\n    route: CAPABILITIES_ROUTE,\n    keybindActionId: 'nav.capabilities'\n  },\n",
      ''
    ],
    ["                  (item.id === 'capabilities' && currentView === 'capabilities') ||\n", '']
  ]
  for (const [before] of replacements) {
    if (source.split(before).length !== 2) throw new Error('Browser top Capabilities link target changed')
  }
  return replacements.reduce((output, [before, after]) => output.replace(before, after), source)
}

export function useBrowserProjectDeleteOwner(source: string, root: string): string {
  const start = 'export async function deleteProject(id: string): Promise<void> {\n  const context = await activeProjectsContext(writableProjectProfile())'
  const request = `  await persistOrRollback(snap, async () => {
    applyPayload(
      await gatewayRequestOn<ProjectsPayload>(
        context.gateway,
        'projects.delete',
        projectParams({ id }, context.profile)
      )
    )
  })`
  const output = replaceBrowserContract(source, [
    [start, start + `
  const allProfiles = viewingAllProfiles()
  const deleteProfile = allProfiles
    ? await browserProjectDeleteProfile(context.gateway, id, $profiles.get().map(profile => profile.name))
    : context.profile
  if (!stillOnWritableProjectOwner(context) || viewingAllProfiles() !== allProfiles) {
    throw new Error('Active Hermes profile changed before deleting the project')
  }
  // Keep the row and its confirmation mounted until the server accepts deletion.
  const payload = await gatewayRequestOn<ProjectsPayload>(
    context.gateway, 'projects.delete', projectParams({ id }, deleteProfile)
  )
  if (!stillOnWritableProjectOwner(context) || viewingAllProfiles() !== allProfiles) {
    void refreshProjectTree()
    return
  }`],
    [request, `  // A sibling profile's project list must never replace the active cache.
  if (deleteProfile === context.profile) applyPayload(payload)`],
    ["// Optimistic: drop the project from the cached tree + list the instant it's\n// clicked (the entered-scope effect exits if you deleted the project you were\n// inside), reconciling from the server payload. A failed delete restores both.",
      '// Remove the cached project only after deletion succeeds so failures stay in the confirmation.']
  ])
  const owner = JSON.stringify(path.join(root, 'src/upstream/project-delete'))
  return `import { browserProjectDeleteProfile } from ${owner}\n` + output
}

export function useBrowserProjectDisclosure(source: string, root: string): string {
  const changes: [string, string][] = [
    ["import { fetchProjectSessions, projectProfile } from '@/store/projects'", "import { notifyError } from '@/store/notifications'"],
    ['  expandedProjectSessions,\n', ''],
    ['expandedProjectSessions(recent, visible)', 'browserExpandedProjectSessions(recent, visible)'],
    [
      `    // All-profiles view has no single backend to ask for one project's lanes;
    // drilling in is the reach there.
    if (!projectProfile()) {
      onEnter?.(project.id)

      return
    }

    setExpanding(true)
    fetchProjectSessions(project.id, { supersedable: false })`,
      '    setExpanding(true)\n    fetchBrowserProjectSessions(project)'
    ],
    ['      .catch(() => onEnter?.(project.id))', "      .catch(error => notifyError(error, 'Could not load project sessions'))"],
    [
      '  if (color && !icon) {\n    return (\n      <SidebarRowLeadGlyph>\n        <span aria-hidden="true" className="size-1 rounded-full" style={{ backgroundColor: color }} />\n      </SidebarRowLeadGlyph>\n    )\n  }\n\n',
      ''
    ],
    [
      "name={icon || (isNoProject ? 'home' : isAuto ? 'repo' : 'folder-library')}",
      "name={isNoProject ? icon || 'home' : open ? 'folder-opened' : 'folder'}"
    ],
    [
      'export function projectIcon({ color, icon, isAuto, isNoProject }: SidebarProjectTree) {',
      'export function projectIcon({ color, icon, isNoProject }: SidebarProjectTree, open = false) {'
    ],
    [
      '      {projectIcon(project)}\n    </SidebarRowGrab>',
      '      <button aria-label={s.projects.toggle(project.label, !open)} className="grid size-full place-items-center bg-transparent" onClick={event => { event.stopPropagation(); toggleOpen() }} type="button">{projectIcon(project, open)}</button>\n    </SidebarRowGrab>'
    ],
    [
      '    <SidebarRowLead>{projectIcon(project)}</SidebarRowLead>',
      '    <SidebarRowLead><button aria-label={s.projects.toggle(project.label, !open)} className="grid size-full place-items-center bg-transparent" onClick={event => { event.stopPropagation(); toggleOpen() }} type="button">{projectIcon(project, open)}</button></SidebarRowLead>'
    ],
    [
      '      aria-label={\n        project.isAuto\n          ? `${s.projects.enter(project.label)} (${s.projects.autoDiscovered})`\n          : s.projects.enter(project.label)\n      }',
      '      aria-label={s.projects.toggle(project.label, !open)}'
    ],
    [
      '      onClick={() => onEnter?.(project.id)}\n    >',
      '      onClick={toggleOpen}\n      onDoubleClick={() => onEnter?.(project.id)}\n    >'
    ]
  ]
  const owner = JSON.stringify(path.join(root, 'src/upstream/project-sessions'))
  return `import { browserExpandedProjectSessions, fetchBrowserProjectSessions } from ${owner}\n` + replaceBrowserContract(source, changes)
}

export function filterBrowserSessionMenu(source: string, root: string): string {
  const target = 'function OptionCheckbox({ checked, onCheck, option }: { checked: boolean; onCheck: () => void; option: Option }) {'
  if (source.split(target).length !== 2) throw new Error('Browser session filter menu target changed')
  const replacements: [string, string][] = [
    ["option.id === 'profile' ? { ...option, label: t.sidebar.gatewayGroups.grouping } : option", "option.id === 'profile' ? { ...option, label: 'Profile' } : option"],
    ['  const groupingLabel = groupings.find(option => option.id === grouping)?.label\n', ''],
    [
      "      {option.label}\n    </DropdownMenuCheckboxItem>",
      "      {option.id === 'archived' ? browserSidebarActionLabel('archived', option.label) : option.label}\n    </DropdownMenuCheckboxItem>"
    ],
    [
      '  const unreadIds = useStore($unreadFinishedSessionIds)',
      `  const unreadIds = useStore($unreadFinishedSessionIds)
  useBrowserSidebarShortcuts({
    archived: { run: () => setSidebarShowArchived(!showArchived) },
    read: { disabled: unreadIds.length === 0, run: markAllSessionsRead }
  })`
    ],
    [
      'function OptionGlyph({ option }: { option: Option }) {',
      `const OPTION_ICONS: Record<string, string> = { 'all-profiles': 'account', archived: 'archive' }

function OptionGlyph({ option }: { option: Option }) {`
    ],
    [
      "  return option.icon ? <Codicon className=\"text-(--ui-text-tertiary)\" name={option.icon} size=\"0.8125rem\" /> : null",
      "  const icon = option.icon || OPTION_ICONS[option.id]\n  return icon ? <Codicon className=\"text-(--ui-text-tertiary)\" name={icon} size=\"0.8125rem\" /> : null"
    ],
    [
      `<DropdownMenuSubTrigger hideChevron>
              {f.grouping}
              <span className="ml-auto flex items-center gap-1 pl-4 text-(--ui-text-tertiary)">
                {groupingLabel}
                <Codicon name="chevron-right" size="1rem" />
              </span>
            </DropdownMenuSubTrigger>`,
      '<DropdownMenuSubTrigger><Codicon name="list-tree" size="0.8125rem" />{f.grouping}</DropdownMenuSubTrigger>'
    ],
    ['<DropdownMenuSubTrigger>{f.ordering}</DropdownMenuSubTrigger>', '<DropdownMenuSubTrigger><Codicon name="list-ordered" size="0.8125rem" />{f.ordering}</DropdownMenuSubTrigger>'],
    ['<DropdownMenuSubTrigger>{f.show}</DropdownMenuSubTrigger>', '<DropdownMenuSubTrigger><Codicon name="eye" size="0.8125rem" />{f.show}</DropdownMenuSubTrigger>'],
    ['<DropdownMenuSubTrigger>{f.status}</DropdownMenuSubTrigger>', '<DropdownMenuSubTrigger><Codicon name="pulse" size="0.8125rem" />{f.status}</DropdownMenuSubTrigger>'],
    ['<DropdownMenuSubTrigger>{f.pullRequest}</DropdownMenuSubTrigger>', '<DropdownMenuSubTrigger><Codicon name="git-pull-request" size="0.8125rem" />{f.pullRequest}</DropdownMenuSubTrigger>'],
    ['<DropdownMenuSubTrigger>{f.profile}</DropdownMenuSubTrigger>', '<DropdownMenuSubTrigger><Codicon name="account" size="0.8125rem" />{f.profile}</DropdownMenuSubTrigger>'],
    ['<DropdownMenuSubTrigger>{f.project}</DropdownMenuSubTrigger>', '<DropdownMenuSubTrigger><Codicon name="root-folder" size="0.8125rem" />{f.project}</DropdownMenuSubTrigger>'],
    ['<DropdownMenuItem onSelect={requestProfileCreate}>{t.profiles.newProfile}</DropdownMenuItem>', '<DropdownMenuItem onSelect={requestProfileCreate}><Codicon name="add" size="0.8125rem" />{t.profiles.newProfile}</DropdownMenuItem>'],
    ['<DropdownMenuItem onSelect={() => void runImportProfileFlow()}>\n                {t.profiles.importProfile}', '<DropdownMenuItem onSelect={() => void runImportProfileFlow()}>\n                <Codicon name="cloud-download" size="0.8125rem" />\n                {t.profiles.importProfile}'],
    ['<DropdownMenuItem onSelect={resetSidebarView}>{f.resetToDefaults}</DropdownMenuItem>', '<DropdownMenuItem onSelect={resetSidebarView}><Codicon name="refresh" size="0.8125rem" />{f.resetToDefaults}</DropdownMenuItem>'],
    ['            {foldCollapsed ? f.expandAll : f.collapseAll}', '            <Codicon name={foldCollapsed ? "expand-all" : "collapse-all"} size="0.8125rem" />\n            {foldCollapsed ? f.expandAll : f.collapseAll}'],
    ['          {t.sidebar.markAllRead}\n', '          <Codicon name="check-all" size="0.8125rem" />\n          {browserSidebarActionLabel(\'read\', t.sidebar.markAllRead)}\n'],
    ['        {foldIds.length > 0 && (', '        <BrowserRestoreProfilesItem />\n        {foldIds.length > 0 && (']
  ]
  let output = source
  for (const [before, after] of replacements) {
    if (output.split(before).length !== 2) throw new Error(`Browser session menu icon contract changed: ${before.slice(0, 48)}`)
    output = output.replace(before, after)
  }
  const hideDesktopOnlyRows = "\n  if (['card-rows', 'profile-rail', 'all-profiles'].includes(option.id)) return null\n"
  const manualOrdering = "      return ordering === 'manual'"
  if (output.split(manualOrdering).length !== 2) throw new Error('Browser manual ordering option contract changed')
  output = output.replace(manualOrdering, '      return true')
  const owner = JSON.stringify(path.join(root, 'src/experience/sidebar-shortcuts'))
  const profilesOwner = JSON.stringify(path.join(root, 'src/experience/profile-list-visibility'))
  return `import { BrowserRestoreProfilesItem } from ${profilesOwner}\nimport { browserSidebarActionLabel, useBrowserSidebarShortcuts } from ${owner}\n` + output.replace(target, target + hideDesktopOnlyRows)
}

export function useBrowserProfileSectionPictures(source: string, root: string): string {
  const replacements: [string, string][] = [
    ["import { WorkspaceAddButton, WorkspaceShowMoreButton } from './projects/workspace-header'", "import { Tip } from '@/components/ui/tooltip'"],
    ["import { SIDEBAR_GROUP_PAGE } from './projects/model'\n", ''],
    ['  const [visibleCount, setVisibleCount] = useState(SIDEBAR_GROUP_PAGE)\n', ''],
    ['  const hiddenCount = embedded ? 0 : Math.max(0, sessions.length - visibleCount)\n', ''],
    ['sessions={embedded ? sessions : sessions.slice(0, visibleCount)}', 'sessions={sessions}'],
    [`          {hiddenCount > 0 && (
            <WorkspaceShowMoreButton
              count={Math.min(SIDEBAR_GROUP_PAGE, hiddenCount)}
              label={label}
              onClick={() => setVisibleCount(count => count + SIDEBAR_GROUP_PAGE)}
            />
          )}\n`, ''],
    ['              <WorkspaceAddButton\n                label={s.newSessionIn(label)}', '              <Tip label={s.newSessionIn(label)}><Button\n                aria-label={s.newSessionIn(label)}\n                size="icon-xs"\n                variant="ghost"'],
    ['              />\n            )}\n            <DropdownMenu>', '              ><Codicon name="add" size="0.75rem" /></Button></Tip>\n            )}\n            <DropdownMenu>'],
    ['  const items = useContributions(SIDEBAR_PROFILE_GROUP_HEADER_AREA)', "  const items = useContributions(SIDEBAR_PROFILE_GROUP_HEADER_AREA).filter(item => item.id !== 'hermes-bots:screen-portal')"],
    ['  const gatewayProfiles = new Map<string, SidebarSessionGroup[]>()', "  const presentationMode = useStore($sidebarGrouping) === 'profile'\n  const gatewayProfiles = new Map<string, SidebarSessionGroup[]>()"],
    ['  const order = useStore($gatewayGroupOrder)', '  const order = useStore($gatewayGroupOrder)\n  const hiddenProfileGroups = useHiddenProfileGroups()'],
    ['  const ordered = [...sections].sort((a, b) => {', "  const ordered = sections.filter(group => embedded || !presentationMode || !hiddenProfileGroups.includes(group.profile ?? '')).sort((a, b) => {"],
    ['              <DropdownMenuContent align="end">', '              <DropdownMenuContent align="end">\n                {browserProfile && group.profile && !embedded && <BrowserHideProfileItem profile={group.profile} />}'],
    ['if (nested || embedded || !owner) {', 'if (nested || embedded || !owner || presentationMode) {'],
    ['  const label = aliases[group.id] || group.label', '  const browserProfile = useBrowserProfileSection(group.profile)\n  const label = aliases[group.id] || browserProfile?.label || group.label'],
    [`              <ProfileGlyph
                className="size-full"
                color={group.color ?? null}
                isDefault={group.profile === 'default'}
                name={group.profile}
              />`, `              browserProfile?.picture ?? <ProfileGlyph
                className="size-full"
                color={group.color ?? null}
                isDefault={group.profile === 'default'}
                name={group.profile}
              />`]
  ]
  let output = source
  for (const [before, after] of replacements) {
    if (output.split(before).length !== 2) throw new Error('Browser profile section picture boundary changed')
    output = output.replace(before, after)
  }
  const owner = JSON.stringify(path.join(root, 'src/upstream/profile-section'))
  const visibilityOwner = JSON.stringify(path.join(root, 'src/experience/profile-list-visibility'))
  return `import { BrowserHideProfileItem, useHiddenProfileGroups } from ${visibilityOwner}\nimport { $sidebarGrouping } from '@/store/layout'\nimport { useBrowserProfileSection } from ${owner}\n` + output
}

export function useBrowserSessionReordering(source: string, surface: 'sidebar' | 'section' | 'groups' | 'row'): string {
  const replacements: [string, string][] = surface === 'sidebar' ? [
    ['  useEffect(() => {\n    const next = resolveManualSessionOrderIds(', '  useEffect(() => {\n    if (sessionsLoading) return\n    const next = resolveManualSessionOrderIds('],
    ['[agentOrderIds, agentOrderManual, unpinnedAgentSessions]', '[agentOrderIds, agentOrderManual, unpinnedAgentSessions, sessionsLoading]'],
    ['onReorderSessions={showAllProfiles ? undefined : reorderSessions}', 'onReorderSessions={reorderSessions}'],
    ['sortable={!showAllProfiles && agentSessions.length > 1}', 'sortable={agentSessions.length > 1}']
  ] : surface === 'section' ? [
    [`    (items: SessionInfo[]) =>
      flattenSessionsWithBranches(items).map(({ branchStem, session }) => renderRow(session, false, branchStem)),
    [renderRow]`, `    (items: SessionInfo[]) => {
      const rows = orderRowsWithinGroups(toSessionRows(flattenSessionsWithBranches(items)), manualOrderIds ?? [])
      const content = rows.map(row => renderListRow(row, sessionsDraggable))
      if (!sessionsDraggable) return content
      const allIds = reorderableRowIds(orderRowsWithinGroups(toSessionRows(flattenSessionsWithBranches(sessions)), manualOrderIds ?? []))
      return <ReorderableList ids={reorderableRowIds(rows)} sensors={dndSensors}
        onReorder={ids => onReorderSessions?.(mergeVisibleReorder(allIds, ids))}>
        {content}
      </ReorderableList>
    },
    [renderListRow, sessionsDraggable, manualOrderIds, sessions, dndSensors, onReorderSessions]`]
  ] : surface === 'row' ? [
    ["          startSessionDrag({ id: session.id, profile: session.profile || 'default', title }, event)", "          if (!reorderable) startSessionDrag({ id: session.id, profile: session.profile || 'default', title }, event)"]
  ] : [
    ['  const rankIds = useStore($sidebarSessionRankIds)', `  const rankedIds = useStore($sidebarSessionRankIds)
  const manualIds = useStore($sidebarSessionOrderIds)
  const manual = useStore($sidebarSessionOrderManual)
  const rankIds = manual ? manualIds : rankedIds`]
  ]
  let output = replaceBrowserContract(source, replacements)
  if (surface === 'groups') output = "import { $sidebarSessionOrderIds, $sidebarSessionOrderManual } from '@/store/layout'\n" + output
  return output
}

export function useBrowserSessionPresentation(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/upstream/profile-groups'))
  return `import { useBrowserProfileGroups } from ${owner}\n` + replaceBrowserContract(source, [
    ['const profileGroups = useGatewaySessionGroups(agentSessions, ownerGrouped, filtersNarrow)', 'const profileGroups = useBrowserProfileGroups(useGatewaySessionGroups(agentSessions, ownerGrouped, filtersNarrow))'],
    ['forceEmptyState={showSessionSkeletons}', 'forceEmptyState={showSessionSkeletons && !displayAgentGroups?.length}'],
    ['  const showSessionSections = hasSessionArea({', '  const showSessionSections = Boolean(displayAgentGroups?.length) || hasSessionArea({'],
    ['label={sessionsLabel}', "label={grouping === 'profile' ? 'Profiles' : sessionsLabel}"],
    ['                        <SidebarSectionAddButton', "                        {grouping !== 'profile' && <SidebarSectionAddButton"],
    ['                        />\n                        <div className="grid size-6 place-items-center">', '                        />}\n                        <div className="grid size-6 place-items-center">']
  ])
}

export function enableBrowserUngroupedSessions(source: string, surface: 'store' | 'menu' | 'sidebar'): string {
  const replacements: Record<typeof surface, [string, string][]> = {
    store: [
      ["export const SIDEBAR_GROUPING_ORDER = ['date', 'project', 'status', 'profile'] as const", "export const SIDEBAR_GROUPING_ORDER = ['none', 'date', 'project', 'status', 'profile'] as const"],
      ["SIDEBAR_GROUPING_STORAGE_KEY,\n  'date',", "SIDEBAR_GROUPING_STORAGE_KEY,\n  'none',"],
      ["oneOf(['date', 'status'], 'date')", "oneOf(['none', 'date', 'status'], 'none')"],
      ["SIDEBAR_ALL_PROFILES_GROUPING_STORAGE_KEY,\n  'date',", "SIDEBAR_ALL_PROFILES_GROUPING_STORAGE_KEY,\n  'profile',"],
      ["oneOf(['date', 'profile', 'status'], 'date')", "oneOf(['none', 'date', 'profile', 'status'], 'profile')"],
      ["const SIDEBAR_DEFAULT_GROUPING: SidebarGrouping = 'date'", "const SIDEBAR_DEFAULT_GROUPING: SidebarGrouping = 'profile'"],
      ["$sidebarFlatGrouping.set(SIDEBAR_DEFAULT_GROUPING)", "$sidebarFlatGrouping.set('none')"],
      ["// reset the choice every time the user flips the rail. Both scopes still ship\n// by day — grouping by owner is something you go and pick.", "// reset the choice every time the user flips the rail. The browser defaults\n// to grouping by profile in the all-profiles scope."]
    ],
    menu: [["  const GROUPING_OPTIONS: Record<SidebarGrouping, Omit<Option<SidebarGrouping>, 'id'>> = {", "  const GROUPING_OPTIONS: Record<SidebarGrouping, Omit<Option<SidebarGrouping>, 'id'>> = {\n    none: { icon: 'list-unordered', label: 'None' },"]],
    sidebar: [["grouping={showArchived || rankedGlobally ? 'none'", "grouping={grouping === 'none' || showArchived || rankedGlobally ? 'none'"]]
  }
  let output = source
  for (const [target, replacement] of replacements[surface]) {
    if (output.split(target).length !== 2) throw new Error(`Browser ungrouped sessions ${surface} target changed`)
    output = output.replace(target, replacement)
  }
  return output
}

export function removeBrowserSplitControls(source: string): string {
  const start = '                // New session + route-backed pages can open in a split —\n'
  const end = '\n              })}'
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  if (source.split(start).length !== 2 || to < from || !source.slice(from, to).includes('<SplitSubmenu')) {
    throw new Error('Browser navigation split menu boundary changed')
  }
  // Keep the navigation button without the split-only context menu.
  return replaceBrowserContract(source.slice(0, from) + `                return <SidebarMenuItem key={item.id}>{button}{isNewSession && <BrowserSidebarSettings />}</SidebarMenuItem>` + source.slice(to), [
    ["import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'\n", ''],
    ["import { CONTEXT_SPLIT_KIT, SplitSubmenu } from './split-submenu'\n", '']
  ])
}

export function disableBrowserSessionTabs(source: string): string {
  const keybind = '    openNewSessionTab,\n'
  const marker = '    // Browser-focused shell does not register chat tab creation.\n    openNewSessionTab: () => undefined,\n'
  const action = '    $newSessionTabAction.set(openNewSessionTab)'
  const disabledAction = '    $newSessionTabAction.set(null)'
  const newSession = '    onNewSessionInWorkspace: (path, owner) => startSessionInWorkspace(path, { openTab: true, owner }),'
  const browserNewSession = '    onNewSessionInWorkspace: (path, owner) => startSessionInWorkspace(path, { owner }),'
  const original = source.replace(marker, keybind).replace(disabledAction, action).replace(browserNewSession, newSession)
  const contract = contracts.find(item => item.module === 'app/contrib/wiring.tsx')!
  if (createHash('sha256').update(original).digest('hex') !== contract.sourceHash || original.split(keybind).length !== 2 || original.split(action).length !== 2 || original.split(newSession).length !== 2) {
    throw new Error('Browser chat tab action contract changed')
  }
  return source.replace(keybind, marker).replace(action, disabledAction).replace(newSession, browserNewSession)
}

export function disableBrowserSessionTileMirrors(source: string): string {
  const target = 'if (!isBrowserWindow() && !isHudWindow()) {'
  const replacement = 'if (false) {'
  const contract = contracts.find(item => item.module === 'app/contrib/controller.tsx')!
  if (createHash('sha256').update(source).digest('hex') !== contract.sourceHash || source.split(target).length !== 2) {
    throw new Error('Browser session tile mirror contract changed')
  }
  // Browser chat navigation is single-view. The desktop-only mirrors create
  // session-tile panes that become chat tabs in the shared layout tree.
  return source.replace(target, replacement)
}

export function useBrowserSessionSelection(source: string, root: string): string {
  const target = `  const openStoredSession = (sessionId: string, session?: SessionInfo) => {
    const ownerRoute = sessionOwnerRouteFromRow(session)

    if (ownerRoute) {
      requestSessionResume(sessionId, ownerRoute)
    } else {
      forgetSessionOwnerHintsForSession(sessionId)
      requestSessionResume(sessionId)
    }

    openSession(sessionId, navigate)
  }`
  if (source.split(target).length !== 2) throw new Error('Browser session selection target changed')
  const adapter = JSON.stringify(path.join(root, 'src/upstream/selection.ts'))
  return (`import { selectBrowserSession } from ${adapter}\n` + source).replace(target, `  const openStoredSession = (sessionId: string, session?: SessionInfo) => selectBrowserSession({
    sessionId, connectionId: session?.connection_id, profile: session?.profile
  }, navigate)`)
}

export function disableBrowserSessionRowTabs(source: string): string {
  const tabAction = "openSession(session.id, () => undefined, 'tab')"
  const windowAction = "openSession(session.id, () => undefined, 'window')"
  const contract = contracts.find(item => item.module === 'app/chat/sidebar/session-row.tsx')!
  if (createHash('sha256').update(source).digest('hex') !== contract.sourceHash || source.split(tabAction).length !== 3 || source.split(windowAction).length !== 2) {
    throw new Error('Browser session row tab gesture contract changed')
  }
  const rowTarget = '      <SidebarRowShell\n        actions={card ? undefined : actionsNode}\n'
  if (source.split(rowTarget).length !== 2) throw new Error('Browser session project-drop row target changed')
  return source.replaceAll(tabAction, 'onResume()').replace(windowAction, 'onResume()')
    .replace(rowTarget, `${rowTarget}        data-web-session-id={session.id}\n        data-web-session-profile={session.profile || 'default'}\n        data-web-session-selected={isSelected || undefined}\n`)
}

export function useBrowserSessionPreview(source: string, root: string): string {
  const output = replaceBrowserContract(source, [
    ["import { OverflowTip, Tip } from '@/components/ui/tooltip'", "import { Tip } from '@/components/ui/tooltip'"],
    ['      <SidebarRowShell\n', '      <BrowserSessionPreview session={session} title={title} disabled={dragging}>\n      <SidebarRowShell\n'],
    ['      </SidebarRowShell>', '      </SidebarRowShell>\n      </BrowserSessionPreview>']
  ])
  // Both list densities use the same static fade and full-row preview.
  if (output.split('<OverflowTip label={title} placement="row">').length !== 3) throw new Error('Browser session title preview target changed')
  return `import { BrowserSessionPreview } from ${JSON.stringify(path.join(root, 'src/experience/session-preview'))}\n` + output
    .replaceAll('<OverflowTip label={title} placement="row">', '<>')
    .replaceAll('</OverflowTip>', '</>')
    .replaceAll('hover-marquee ', 'browser-session-title ')
    .replaceAll('onPointerEnter={armMarquee}', '')
    .replaceAll('onPointerLeave={disarmMarquee}', '')
}

export function disableBrowserSessionOpenActions(source: string, root: string): string {
  const tabCondition = "...(surface === 'row' && !alreadyTabbed"
  const windowCondition = '...(canOpenSessionWindow()'
  const closeCondition = '...(tabPaneId\n'
  const projectTarget = '        >\n          {node.label}\n        </kit.Item>'
  const contextCopyTarget = '      <CopyButton\n        appearance={kit.copyAppearance}'
  const contextProjectTarget = '      <kit.Sub>\n        <kit.SubTrigger disabled={!sessionId}>\n          <Codicon name="folder"'
  const copyImport = "import { CopyButton } from '@/components/ui/copy-button'\n"
  const contract = contracts.find(item => item.module === 'app/chat/sidebar/session-actions-menu.tsx')!
  if (createHash('sha256').update(source).digest('hex') !== contract.sourceHash || source.split(tabCondition).length !== 2 || source.split(windowCondition).length !== 2 || source.split(closeCondition).length !== 3 || source.split(projectTarget).length !== 2 || source.split(contextCopyTarget).length !== 2 || source.split(contextProjectTarget).length !== 2 || source.split(copyImport).length !== 2) {
    throw new Error('Browser session open-action contract changed')
  }
  // Browser chat is single-view. Remove tab/window and copy/branch/export
  // actions while retaining session mutations and project destinations.
  const output = source.replace(tabCondition, '...(false').replace(windowCondition, '...(false')
    .replaceAll(closeCondition, '...(tabPaneId && !window.__HERMES_WEB_BRIDGE__\n')
    .replace(projectTarget, '        >\n          <Codicon name="root-folder" size="0.875rem" />\n          {node.label}\n        </kit.Item>')
  const copyStart = output.indexOf(contextCopyTarget)
  const projectStart = output.indexOf(contextProjectTarget, copyStart)
  if (copyStart < 0 || projectStart < 0) throw new Error('Browser session context-action boundary changed')
  const owner = JSON.stringify(path.join(root, 'src/experience/session-shortcuts'))
  let menu = (output.slice(0, copyStart) + output.slice(projectStart)).replace(copyImport, '')
  const shortcuts = [
    ['        suppressCloseFocusRef.current = true', '        suppressCloseFocusRef.current = Boolean(document.querySelector(\'[role="menu"]\'))'],
    ['      label: r.rename,', "      key: 'rename',\n      label: browserSessionActionLabel('rename', r.rename.replace(/(?:\\.{3}|…)$/, '')),"],
    ['      label: pinned ? r.unpin : r.pin,', "      key: 'pin',\n      label: browserSessionActionLabel('pin', pinned ? r.unpin : r.pin),"],
    ['      label: unread || isUnread ? r.markRead : r.markUnread,', "      key: 'unread',\n      label: browserSessionActionLabel('unread', unread || isUnread ? r.markRead : r.markUnread),"],
    ['      label: archived ? r.unarchive : r.archive,', "      key: 'archive',\n      label: browserSessionActionLabel('archive', archived ? r.unarchive : r.archive),"],
    ['      label: t.common.delete,', "      key: 'delete',\n      label: browserSessionActionLabel('delete', t.common.delete),"],
  ]
  for (const [before, after] of shortcuts) {
    if (menu.split(before).length !== 2) throw new Error('Browser session shortcut contract changed')
    menu = menu.replace(before, after)
  }
  return `import { browserSessionActionLabel } from ${owner}\n` + menu
}

/** Session references are browser links, including their native link gestures. */
export function useBrowserSessionLinks(source: string, root: string): string {
  const start = source.indexOf('export function openSessionRef(value: string) {')
  const end = source.indexOf('\n/** What activating a directive', start)
  if (start < 0 || end < 0) throw new Error('Browser session reference action boundary changed')
  const output = source.slice(0, start) + `export function openSessionRef(value: string) {
  const href = browserSessionRefHref(value)
  if (href) void window.hermesDesktop?.openExternal(href)
}
` + source.slice(end)
  const owner = JSON.stringify(path.join(root, 'src/upstream/browser-session-links'))
  return `import { browserSessionRefHref } from ${owner}\n` + replaceBrowserContract(output, [
    ['<DirectiveChip id={value} label={resolved} onClick={() => openSessionRef(value)} type="session" />', '<DirectiveChip id={value} label={resolved} type="session" />'],
    ["  session: {\n    icon: 'link-external',", "  session: {\n    href: browserSessionRefHref,\n    icon: 'link-external',"],
    [`<a
      {...refAttrs('session', 'wrap-anywhere')}
      href="#"
      onClick={event => {
        event.preventDefault()
        event.stopPropagation()
        openSessionRef(value)
      }}`, `<ExternalLink
      {...refAttrs('session', 'wrap-anywhere')}
      href={browserSessionRefHref(value)}`],
    ['      <DirectiveIcon type="session" />\n      {resolved}\n    </a>', '      <DirectiveIcon type="session" />\n      {resolved}\n    </ExternalLink>']
  ])
}

/** Pane fallback menus retain reload and app actions without desktop tab verbs. */
export function removeBrowserZoneTabControls(source: string): string {
  const start = source.indexOf('        <kit.Separator />\n        {paneTabCloseItems(kit, {')
  const end = source.indexOf('        {minimizable &&', start)
  if (start < 0 || end < 0) throw new Error('Browser zone tab menu boundary changed')
  return source.slice(0, start) + source.slice(end)
}

export function removeBrowserTabPaletteControl(source: string): string {
  const start = source.indexOf("  paletteToggle({\n    id: 'view.toggleTabStrip',")
  const end = source.indexOf("  // The keybind panel's non-titlebar door", start)
  if (start < 0 || end < 0) throw new Error('Browser tab palette boundary changed')
  return source.slice(0, start) + source.slice(end)
}

export function removeBrowserShellTabControl(source: string): string {
  const start = source.indexOf('      // The pointer-only way back to a hidden tab strip:')
  const end = source.indexOf('      settings', start)
  if (start < 0 || end < 0) throw new Error('Browser shell tab menu boundary changed')
  return source.slice(0, start) + source.slice(end)
}
