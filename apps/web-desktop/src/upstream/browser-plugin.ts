import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { Plugin } from 'vite'
import registry from './compatibility-registry.json'
const contracts = registry.filter(entry => entry.sourceRoot === 'renderer' && entry.module && entry.sourceHash)
const storageScope = `\n  if (/^hermes\\.desktop\\.(?:layout|pane|sidebar|fileBrowser|rightRail|profileRail|terminal|statusbar|hiddenStrip|dismissedPanes|userPlaced)/.test(key)) key = 'hermes-web.browser.' + key\n`
const browserRootPath = (root: string): string => path.join(root, 'src/upstream/browser-root.tsx')

function assertBrowserRoot(root: string): void {
  const rootFile = browserRootPath(root)
  if (!existsSync(rootFile)) throw new Error(`Browser root is missing: ${rootFile}`)
  const source = readFileSync(rootFile, 'utf8')
  if (!source.includes('return <BrowserShell />') || source.includes('ContribController')) {
    throw new Error('Browser build root is not the browser-only shell')
  }
}
/** Keep upstream boot/error/reconnect ownership; only adapt its loading visual. */
export function useBrowserConnectingVisual(source: string): string {
  const start = source.indexOf('function ConnectingOverlayView(')
  const end = source.indexOf('export function GatewayConnectingOverlay()', start)
  if (start < 0 || end < 0 || !source.slice(start, end).includes('<DecodeText')) {
    throw new Error('Gateway connecting presentation changed')
  }
  return source.slice(0, start)
    .replace("import { DecodeText } from '@/components/ui/decode-text'\n", '')
    .replace("import { cn } from '@/lib/utils'\n", '')
    .replace("const TEXT = 'CONNECTING'\n", '') + `function ConnectingOverlayView({ onExit, phase }: ConnectingOverlayViewProps) {
  return (
    <div className="hermes-startup-loading athena-connecting-overlay" role="status" data-glass-opaque=""
      style={{ opacity: phase === 'overlay-out' || phase === 'gone' ? 0 : 1 }}>
      {onExit ? <SlowSetupStart onExit={onExit} /> : <>
        <img className="hermes-startup-logo" src="/athena.svg" width="64" height="64" alt="" aria-hidden="true" />
        <span className="hermes-startup-spinner" aria-hidden="true" />
        <span className="hermes-startup-label">Connecting to Hermes…</span>
      </>}
    </div>
  )
}

` + source.slice(end)
}

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
    browserPreviousPinOrder = previous
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
    ['    onNewSessionInWorkspace: path => startSessionInWorkspace(path),', '    onNewSessionInWorkspace: path => { prepareDefaultNewSession(); startSessionInWorkspace(path) },']
  ]
  for (const [target, replacement] of targets) {
    if (source.split(target).length !== 2) throw new Error('Browser default new-session profile entry point changed')
    source = source.replace(target, replacement)
  }
  return `import { prepareDefaultNewSession } from ${owner}\n` + source
}

export function useBrowserRosterDialogFocus(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/experience/ui/dialog-focus'))
  const targets = [
    ['export function GroupDialog({ bot, onClose }: GroupDialogProps) {', 'true', '      <DialogContent className="max-w-sm">', '      <DialogContent className="max-w-sm" data-browser-bot-dialog="section" onCloseAutoFocus={browserReturnFocus}>'],
    ['export function EditProfileDialog({ bot, open, onClose }: EditProfileDialogProps) {', 'open', '      <DialogContent\n', '      <DialogContent\n        data-browser-bot-dialog={advanced ? \'advanced\' : \'section\'}\n        onCloseAutoFocus={browserReturnFocus}\n'],
    ['}: ConfirmDialogProps) {', 'open', '      <DialogContent\n', '      <DialogContent\n        data-browser-bot-dialog="confirm"\n        onCloseAutoFocus={browserReturnFocus}\n']
  ]
  const target = targets.find(([start]) => source.includes(start))
  if (!target) throw new Error('Browser roster dialog boundary changed')
  const [start, open, before, after] = target
  if (source.split(start).length !== 2 || source.split(before).length !== 2) throw new Error('Browser roster dialog focus target changed')
  source = source.replace(start, start + `\n  const browserReturnFocus = useBrowserDialogReturnFocus(${open})`).replace(before, after)
  return source.includes('import { useBrowserDialogReturnFocus }') ? source : `import { useBrowserDialogReturnFocus } from ${owner}\n` + source
}

export function useBrowserBotDialogFocus(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/experience/ui/dialog-focus'))
  const changes = [
    ['export function CreateAgentDialog({ open, onClose, onConfigureModel, roster }: CreateAgentDialogProps) {', 'export function CreateAgentDialog({ open, onClose, onConfigureModel, roster }: CreateAgentDialogProps) {\n  const browserReturnFocus = useBrowserDialogReturnFocus(open)'],
    ['export function CreateGroupChatDialog({ open, roster, onClose, onCreated }: CreateGroupChatDialogProps) {', 'export function CreateGroupChatDialog({ open, roster, onClose, onCreated }: CreateGroupChatDialogProps) {\n  const browserReturnFocus = useBrowserDialogReturnFocus(open)'],
    ['      <DialogContent\n', '      <DialogContent\n        data-browser-bot-dialog={advanced ? \'advanced\' : \'create\'}\n        onCloseAutoFocus={browserReturnFocus}\n'],
    ['      <DialogContent className="max-w-md">', '      <DialogContent className="max-w-md" data-browser-bot-dialog="group" onCloseAutoFocus={browserReturnFocus}>']
  ]
  for (const [before, after] of changes) {
    if (source.split(before).length !== 2) throw new Error('Browser Bot dialog focus boundary changed')
    source = source.replace(before, after)
  }
  return `import { useBrowserDialogReturnFocus } from ${owner}\n` + source
}

export function useBrowserSectionDialogFocus(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/experience/ui/dialog-focus'))
  const start = 'export function SectionNameDialog({ initialName, mode, onOpenChange, onSubmit, open }: SectionNameDialogProps) {'
  const content = '      <DialogContent className="max-w-sm">'
  if (source.split(start).length !== 2 || source.split(content).length !== 2) throw new Error('Browser section dialog focus boundary changed')
  return `import { useBrowserDialogReturnFocus } from ${owner}\n` + source
    .replace(start, start + '\n  const browserReturnFocus = useBrowserDialogReturnFocus(open)')
    .replace(content, '      <DialogContent className="max-w-sm" data-browser-bot-dialog="section" onCloseAutoFocus={browserReturnFocus}>')
}

export function useBrowserRosterActionSurfaces(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/experience/browser-roster-actions'))
  const start = '  return (\n    <ContextMenu>'
  const end = '    </ContextMenu>\n  )'
  const replacements = [
    '  return <BrowserBotRowActions bot={bot} row={row} onDelete={onDelete} onEdit={onEdit} onGroup={onGroup} onNewSection={onNewSection} />',
    '  return <BrowserGroupRowActions name={group} deleteLabel={b.group.deleteAction} row={row} onOpen={() => onOpen(group)} onDelete={() => onDisband({ name: group, members })} />'
  ]
  if (source.split(start).length !== 3 || source.split(end).length !== 3) throw new Error('Browser roster action boundary changed')
  for (const replacement of replacements) {
    const from = source.indexOf(start)
    const to = source.indexOf(end, from) + end.length
    source = source.slice(0, from) + replacement + source.slice(to)
  }
  return `import { BrowserBotRowActions, BrowserGroupRowActions } from ${owner}\n` + source
}

export function useBrowserSectionActionSurface(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/experience/browser-roster-actions'))
  const start = '}: UserSectionHeaderProps) {'
  const end = '\n// ── drop zone'
  if (source.split(start).length !== 2 || source.split(end).length !== 2) throw new Error('Browser section action boundary changed')
  const from = source.indexOf(start) + start.length
  const to = source.indexOf(end, from)
  return `import { BrowserBotSectionHeader } from ${owner}\n` + source.slice(0, from) + '\n  return <BrowserBotSectionHeader {...{ canMoveDown, canMoveUp, collapsed, count, id, name, onDelete, onMove, onRename, onToggle }} />\n}\n' + source.slice(to)
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

export function useBrowserSettingsToolActions(source: string, root: string): string {
  const target = '<SettingsView\n'
  const end = '\n        </Suspense>\n      )}\n\n      {currentView'
  if (source.split(target).length !== 2 || source.split(end).length !== 2) throw new Error('Browser settings tool action boundary changed')
  const owner = JSON.stringify(path.join(root, 'src/experience/settings/embedded-overlay'))
  return `import { BrowserSettingsToolActions } from ${owner}\n` + source
    .replace(target, '<BrowserSettingsToolActions.Provider value={{ onDeleteSession: removeSession, onOpenSession: sessionId => openSession(sessionId, navigate) }}>\n          <SettingsView\n')
    .replace(end, '\n          </BrowserSettingsToolActions.Provider>' + end)
}

export function useBrowserSettingsPresentation(source: string, root: string): string {
  const importTarget = "import { OverlayMain, OverlayNav, type OverlayNavGroup, OverlaySplitLayout } from '../overlays/overlay-split-layout'"
  const overlayImport = "import { OverlayView } from '../overlays/overlay-view'"
  const overlayTarget = '<OverlayView closeLabel={t.settings.closeSettings} edgeBadge={searchPill} onClose={onClose}>'
  const layoutStart = source.indexOf('      <OverlaySplitLayout>')
  const layoutEnd = source.indexOf('      </OverlaySplitLayout>', layoutStart)
  if (source.split(importTarget).length !== 2 || source.split(overlayImport).length !== 2 || layoutStart < 0 || layoutEnd < 0 || source.split(overlayTarget).length !== 2) {
    throw new Error('Browser settings presentation boundary changed')
  }
  const controlReplacements: [string, string][] = [
    ['      type="button"\n    >\n      <Search className="size-3" />', '      aria-label={t.settings.search.pill}\n      type="button"\n    >\n      <Search className="size-3" />'],
    ["useRouteEnumParam('tab', SETTINGS_VIEWS, 'config:model' as SettingsViewId)", "useRouteEnumParam('tab', SETTINGS_VIEWS, 'config:appearance' as SettingsViewId)"],
    [
      '  const subpage = resolveSettingsSubpage(activeView, params)',
      "  const browserThemeRedirect = activeView === 'config:appearance' && resolveSettingsSubpage(activeView, params) === 'theme'\n  const browserSoundsRedirect = activeView === 'notifications' && resolveSettingsSubpage(activeView, params) === 'sounds'\n  const subpage = ['gateway', 'keybinds', 'sessions', 'config:safety', 'config:appearance', 'config:chat'].includes(activeView) ? undefined : resolveSettingsSubpage(activeView, params)"
    ],
    [
      '  const needsSubpageRedirect = Boolean(subpage && subpage !== requestedSubpage)',
      '  const needsSubpageRedirect = browserThemeRedirect || browserSoundsRedirect || Boolean(subpage && subpage !== requestedSubpage)'
    ],
    [
      "  if (subpage) {\n    subpageSearch.set('page', subpage)\n  }",
      "  if (browserThemeRedirect) {\n    subpageSearch.set('tab', 'config:browser-theme')\n    subpageSearch.delete('page')\n  } else if (browserSoundsRedirect) {\n    subpageSearch.set('tab', 'config:browser-sounds')\n    subpageSearch.delete('page')\n  } else if (subpage) {\n    subpageSearch.set('page', subpage)\n  }"
    ],
    [
      '      const destination = page ?? settingsSubpages(view)[0]?.id',
      "      const destination = page ?? (['gateway', 'keybinds', 'sessions', 'config:safety', 'config:appearance', 'config:chat'].includes(view) ? undefined : settingsSubpages(view)[0]?.id)"
    ],
    ["        const children = settingsSubpages(view)", "        const children = ['config:appearance', 'config:chat', 'notifications'].includes(view) ? [] : settingsSubpages(view)"],
    ["import { SettingsSubpageHeader } from './subpage-navigation'\n", ''],
    ["  const activeGroup = navGroups.find(group => group.active)\n  const activeChild = activeGroup?.children?.find(child => child.active)\n", ''],
  ]
  controlReplacements.push(
    ["const SETTINGS_VIEWS: readonly SettingsViewId[] = [", "const SETTINGS_VIEWS: readonly SettingsViewId[] = [\n  ...SETTINGS_TOOL_PAGES.map(page => page.id),\n  'config:browser-theme',\n  'config:browser-sounds',\n  'config:browser-configuration',"],
    ["          {\n            active: activeView === 'notifications',", "          {\n            active: activeView === 'config:browser-theme',\n            icon: codiconIcon('color-mode'),\n            id: 'config:browser-theme',\n            label: 'Theme',\n            onSelect: () => setActiveView('config:browser-theme')\n          },\n          {\n            active: activeView === 'config:browser-sounds',\n            icon: codiconIcon('unmute'),\n            id: 'config:browser-sounds',\n            label: 'Sounds',\n            onSelect: () => setActiveView('config:browser-sounds')\n          },\n          {\n            active: activeView === 'notifications',"],
    ["          {\n            active: activeView === 'about',", "          {\n            active: activeView === 'config:browser-configuration',\n            gapBefore: true,\n            icon: Settings2,\n            id: 'config:browser-configuration',\n            label: 'Configuration',\n            onSelect: () => setActiveView('config:browser-configuration')\n          },\n          {\n            active: activeView === 'about',"],
    ['      importInputRef={importInputRef}', '      importInputRef={importInputRef}\n      configurationCommands={configurationCommands}\n      configurationScopeProfile={scopeProfile}'],
    ['getHermesConfigRecord()', 'getHermesConfigRecord(scopeProfile)'],
    ['saveHermesConfig(await getHermesConfigDefaults())', 'saveHermesConfig(await getHermesConfigDefaults(), scopeProfile)'],
    ['title: t.settings.resetConfirm', 'title: `${t.settings.resetConfirm} — ${scopeProfile}`']
  )
  for (const [before] of controlReplacements) {
    if (source.split(before).length !== 2) throw new Error('Browser settings control labels changed')
  }
  const owner = JSON.stringify(path.join(root, 'src/experience/settings/frame'))
  const navFooterStart = '  const navFooter = ('
  const activeContentStart = '\n\n  const SubpageView ='
  if (source.split(navFooterStart).length !== 2 || source.split(activeContentStart).length !== 2) {
    throw new Error('Browser configuration command boundary changed')
  }
  const navFooter = `  const configurationCommands = {
    export: {
      description: 'Download this profile’s configuration as a JSON file.',
      label: t.settings.exportConfig,
      run: exportConfig
    },
    import: {
      description: 'Restore this profile’s configuration from a JSON file.',
      label: t.settings.importConfig,
      run: () => {
        triggerHaptic('open')
        importInputRef.current?.click()
      }
    },
    reset: {
      description: 'Restore this profile’s configuration defaults, including hidden options. You will be asked to confirm.',
      label: t.settings.resetToDefaults,
      run: () => {
        triggerHaptic('warning')
        return resetConfig()
      }
    }
  }`
  const layoutTarget = source.slice(layoutStart, layoutEnd + '      </OverlaySplitLayout>'.length)
  const layoutReplacement = `      <SettingsBreadcrumbContext.Provider value={false}>
        {needsSubpageRedirect ? (
          <Navigate replace to={{ hash, pathname, search: '?' + subpageSearch }} />
        ) : (
          SETTINGS_TOOL_PAGES.some(page => page.id === activeView)
            ? <BrowserSettingsToolContent view={activeView} onClose={onClose} />
            : activeSettingsContent
        )}
      </SettingsBreadcrumbContext.Provider>`
  let output = source
    .replace(importTarget, '')
    .replace(overlayImport, '')
    .replace(overlayTarget, '<BrowserSettingsPresentation activeView={activeView} backLabel={t.common.back} closeLabel={t.settings.closeSettings} groups={navGroups} onClose={onClose} search={searchPill} title={t.commandCenter.settings}>')
    .replace(layoutTarget, layoutReplacement)
    .replace('</OverlayView>', '</BrowserSettingsPresentation>')
  const transformedNavStart = output.indexOf(navFooterStart)
  const transformedNavEnd = output.indexOf(activeContentStart, transformedNavStart)
  output = output.slice(0, transformedNavStart) + navFooter + output.slice(transformedNavEnd)
  for (const [before, after] of controlReplacements) output = output.replace(before, after)
  return `import { SETTINGS_TOOL_PAGES, BrowserSettingsToolContent } from ${JSON.stringify(path.join(root, 'src/upstream/settings-tools'))}\nimport { BrowserSettingsPresentation } from ${owner}\n` + output
}

export function useBrowserConfigurationSettings(source: string, root: string): string {
  const replacements: [string, string][] = [
    ['  importInputRef\n}: ConfigSettingsProps)', '  importInputRef,\n  configurationCommands,\n  configurationScopeProfile\n}: ConfigSettingsProps)'],
    ['      importInputRef={importInputRef}', '      importInputRef={importInputRef}\n      configurationCommands={configurationCommands}\n      configurationScopeProfile={configurationScopeProfile}'],
    ['  importInputRef: React.RefObject<HTMLInputElement | null>', '  importInputRef: React.RefObject<HTMLInputElement | null>\n  configurationCommands: BrowserConfigurationCommands\n  configurationScopeProfile?: string'],
    ['  importInputRef,\n  scopeProfile', '  importInputRef,\n  configurationCommands,\n  configurationScopeProfile,\n  scopeProfile'],
    ['  const scopeProfile = useStore($settingsRequestProfile)', '  const requestScopeProfile = useStore($settingsRequestProfile)\n  const scopeProfile = activeSectionId === \'browser-configuration\' ? configurationScopeProfile : requestScopeProfile'],
    ["  const visibleFields =", `  if (activeSectionId === 'browser-configuration') {
    return <SettingsContent>
      <BrowserConfigurationPage commands={configurationCommands} scopeProfile={configurationScopeProfile} />
      <input accept=".json,application/json" className="hidden" onChange={handleImport} ref={importInputRef} type="file" />
    </SettingsContent>
  }

  const visibleFields =`]
  ]
  let output = source
  for (const [before, after] of replacements) {
    if (output.split(before).length !== 2) throw new Error('Browser configuration page boundary changed')
    output = output.replace(before, after)
  }
  return `import type { BrowserConfigurationCommands } from ${JSON.stringify(path.join(root, 'src/experience/settings/configuration'))}\nimport { BrowserConfigurationPage } from ${JSON.stringify(path.join(root, 'src/experience/settings/configuration'))}\n` + output
}

export function hideBrowserAppearanceOnlySettings(source: string): string {
  const replacements: [string, string][] = [
    ['              {a.intro}', '              {!window.__HERMES_WEB_BRIDGE__ && a.intro}'],
    ['<SectionHeading icon={Palette} title={a.title} />', '{!window.__HERMES_WEB_BRIDGE__ && <SectionHeading icon={Palette} title={a.title} />}'],
    [
      "  const show = (id: AppearanceSubpageId) => subpage === undefined || subpage === id",
      `  const show = (id: AppearanceSubpageId) => {
    return window.__HERMES_WEB_BRIDGE__
      ? ['general', 'typography', 'window-layout', 'chat-display'].includes(id)
      : subpage === undefined || subpage === id
  }`
    ],
    ['                <TerminalFontSetting />', '                {!window.__HERMES_WEB_BRIDGE__ && <TerminalFontSetting />}'],
    ["{show('pet') && (", "{show('pet') && !window.__HERMES_WEB_BRIDGE__ && ("],
    ["{show('window-layout') && TRANSLUCENCY_SUPPORTED && (", "{show('window-layout') && TRANSLUCENCY_SUPPORTED && !window.__HERMES_WEB_BRIDGE__ && ("],
    [
      '                  <MarketplaceThemeResults installs={installs} onInstalled={name => setTheme(name)} query={query} />',
      '                  {!window.__HERMES_WEB_BRIDGE__ && <MarketplaceThemeResults installs={installs} onInstalled={name => setTheme(name)} query={query} />}'
    ],
    ['placeholder={a.themeSearchPlaceholder}', 'placeholder="Search available themes"'],
    ['description={a.themeDesc}', 'description="Choose from themes available in this web app."'],
    ["          {show('theme') && (\n            <ListRow", "          {show('theme') && (\n            <>\n              <SectionHeading icon={Palette} title=\"Colour theme\" />\n              <ListRow"],
    ['              id={settingElementId(ids.theme)}', '              className="browser-theme-mode-row"\n              id={settingElementId(ids.theme)}'],
    ['              wide\n            />\n          )}\n\n          {show(\'typography\')', '              wide\n              />\n            </>\n          )}\n\n          {show(\'typography\')']
  ]
  let output = source
  for (const [before, after] of replacements) {
    if (output.split(before).length !== 2) throw new Error('Browser appearance capability boundary changed')
    output = output.replace(before, after)
  }
  for (const title of ['tabStripTitle', 'appActionsTitle']) {
    const marker = `title={a.${title}}`
    if (output.split(marker).length !== 2) throw new Error(`Browser appearance setting boundary changed: ${title}`)
    const titleIndex = output.indexOf(marker)
    const visibility = "{show('window-layout') && ("
    const start = output.lastIndexOf(visibility, titleIndex)
    if (start < 0) throw new Error(`Browser appearance setting boundary changed: ${title}`)
    output = `${output.slice(0, start)}{show('window-layout') && !window.__HERMES_WEB_BRIDGE__ && (${output.slice(start + visibility.length)}`
  }
  for (const title of ['tipsTitle', 'toursTitle', 'userBubbleTitle']) {
    const marker = `label={a.${title}}`
    const markerPosition = output.indexOf(marker)
    const conditionStart = output.lastIndexOf('{show(', markerPosition)
    const conditionEnd = conditionStart < 0 ? -1 : output.indexOf('&&', conditionStart)
    if (markerPosition < 0 || conditionStart < 0 || conditionEnd < 0 || conditionEnd >= markerPosition) {
      throw new Error(`Browser appearance setting boundary changed: ${title}`)
    }
    const guardEnd = conditionEnd + '&&'.length
    output = output.slice(0, guardEnd) + ' !window.__HERMES_WEB_BRIDGE__ &&' + output.slice(guardEnd)
  }
  return output
}

export function keepBrowserMessageBubblesSolid(source: string): string {
  const replacements: [string, string][] = [
    ['clampIntensity(storedString(KEY))', '(window.__HERMES_WEB_BRIDGE__ ? TRANSLUCENCY_MIN : clampIntensity(storedString(KEY)))'],
    ['$userBubbleTransparency.set(clampIntensity(value))', '$userBubbleTransparency.set(window.__HERMES_WEB_BRIDGE__ ? TRANSLUCENCY_MIN : clampIntensity(value))']
  ]
  let output = source
  for (const [before, after] of replacements) {
    if (output.split(before).length !== 2) throw new Error('Browser message bubble transparency boundary changed')
    output = output.replace(before, after)
  }
  return output
}

export function hideBrowserLocalProjectDirectory(source: string): string {
  const target = 'function DefaultProjectDirSetting() {'
  if (source.split(target).length !== 2) throw new Error('Browser archived-chat directory boundary changed')
  return source.replace(target, `${target}\n  if (window.__HERMES_WEB_BRIDGE__) return null`)
}

export function filterBrowserSettingsFields(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/experience/settings/policy'))
  const target = "  const visibleFields = activeSectionId === 'voice' ? fields.filter(([key]) => voiceFieldVisible(key, config)) : fields"
  if (source.split(target).length !== 2) throw new Error('Browser settings field visibility target changed')
  let output = source.replace(target, target + '.filter(([key]) => isSettingsFieldVisible(key))')
  const mapStart = '          {visibleFields.map(([key, field]) => (\n'
  const mapEnd = '\n          ))}'
  const mapStartIndex = output.indexOf(mapStart)
  const mapEndIndex = output.indexOf(mapEnd, mapStartIndex)
  if (mapStartIndex < 0 || mapEndIndex < 0 || output.indexOf(mapStart, mapStartIndex + mapStart.length) >= 0) {
    throw new Error('Browser settings field rendering boundary changed')
  }
  const browserOnlyControls: [string, string][] = [
    ["const showDesktopSettings = activeSectionId === 'advanced'", "const showDesktopSettings = !window.__HERMES_WEB_BRIDGE__ && activeSectionId === 'advanced'"],
    ["const showAttachments = activeSectionId === 'chat'", "const showAttachments = !window.__HERMES_WEB_BRIDGE__ && activeSectionId === 'chat'"]
  ]
  for (const [before, after] of browserOnlyControls) {
    if (output.split(before).length !== 2) throw new Error('Browser device-only configuration boundary changed')
    output = output.replace(before, after)
  }
  return `import { isSettingsFieldVisible } from ${owner}\n` + output
}

export function keepBrowserProfileTabFocus(source: string): string {
  const target = '    view.focus()\n\n    return () => {'
  if (source.split(target).length !== 2) throw new Error('Browser profile editor focus boundary changed')
  return source.replace(target, `    if (!host.closest('[data-browser-profile-settings]')) view.focus()

    return () => {`)
}

export function useBrowserProfileSettingsTabs(source: string, root: string): string {
  const start = '          <PanelHeader subtitle={p.count(profiles.length)} title={p.title} />'
  const end = '            </PanelList>'
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  const query = "  const [query, setQuery] = useState('')\n"
  const filterStart = '  const visibleProfiles = useMemo(() => {'
  const filterEnd = '  }, [profiles, query])\n'
  if (source.split(start).length !== 2 || source.split(end).length !== 2 || source.split('</PanelBody>').length !== 2
    || source.split(query).length !== 2 || source.split(filterStart).length !== 2 || source.split(filterEnd).length !== 2 || to < from) {
    throw new Error('Browser profile settings tab boundary changed')
  }
  const owner = JSON.stringify(path.join(root, 'src/experience/settings/profile-tabs'))
  const output = source.slice(0, from) + `          <BrowserProfileSettings
            profiles={profiles}
            selectedName={selected?.name}
            onSelect={setSelectedName}
            onCreate={() => setCreateOpen(true)}
            onRename={setPendingRename}
            onDelete={setPendingDelete}
          >` + source.slice(to + end.length)
  const filterFrom = output.indexOf(filterStart)
  const filterTo = output.indexOf(filterEnd, filterFrom) + filterEnd.length
  return `import { BrowserProfileSettings } from ${owner}\n` + (output.slice(0, filterFrom) + output.slice(filterTo))
    .replace(query, '').replace('</PanelBody>', '</BrowserProfileSettings>')
}

export function useBrowserProfileScopeTabs(source: string): string {
  const replacements: [string, string][] = [
    [
      '      <div className="text-[length:var(--conversation-caption-font-size)] font-medium text-(--ui-text-secondary)">\n        {scope.appliesTo}\n      </div>\n',
      ''
    ],
    [
      '      {override !== null || editingNonDefault ? (',
      '      {!window.__HERMES_WEB_BRIDGE__ && (override !== null || editingNonDefault) ? ('
    ],
    [
      'export function ActiveProfileNote({ className }: { className?: string }) {',
      'export function ActiveProfileNote({ className }: { className?: string }) {\n  if (window.__HERMES_WEB_BRIDGE__) return null'
    ],
    [
      "<div className={cn('grid gap-2', className)}>",
      "<div className={cn('grid gap-2', className)} data-browser-profile-scope=\"\">"
    ],
    [
      '<div className="flex flex-wrap gap-1.5">',
      '<div className="flex flex-wrap gap-1.5" data-browser-profile-tabs="" role="group" aria-label={scope.appliesTo}>'
    ],
    [
      "      className={cn(\n        'rounded-full border px-3 py-1 text-[length:var(--conversation-caption-font-size)] transition',",
      "      className={cn(\n        'browser-settings-profile-tab rounded-none border-0 border-b-2 border-transparent px-3 py-2 text-[length:var(--conversation-caption-font-size)] transition',"
    ],
    [
      '      onClick={onSelect}\n      type="button"',
      '      aria-pressed={active}\n      onClick={onSelect}\n      type="button"'
    ]
  ]
  let output = source
  for (const [before, after] of replacements) {
    if (output.split(before).length !== 2) throw new Error('Browser profile scope tab boundary changed')
    output = output.replace(before, after)
  }
  return output
}

export function filterBrowserSettingsSearch(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/experience/settings/policy'))
  const target = `  return {
    subpageEntries,
    settingEntries,
    configEntries,
    credentialEntries,
    pluginEntries
  }`
  if (source.split(target).length !== 2) throw new Error('Browser settings search catalog target changed')
  const filtered = `  return {
    subpageEntries: subpageEntries.filter(entry => isSettingsSectionVisible(entry.target.view) && isSettingsFieldVisible(entry.target.setting ?? '')).map(presentSettingsSearchEntry),
    settingEntries: settingEntries.filter(entry => isSettingsSectionVisible(entry.target.view) && isSettingsFieldVisible(entry.target.setting ?? '')).map(presentSettingsSearchEntry),
    configEntries: configEntries.filter(entry => isSettingsSectionVisible(entry.target.view) && isSettingsFieldVisible(entry.target.field ?? '')).map(presentSettingsSearchEntry),
    credentialEntries: credentialEntries.map(presentSettingsSearchEntry),
    pluginEntries
  }`
  return `import { isSettingsFieldVisible, isSettingsSectionVisible, presentSettingsSearchEntry } from ${owner}\n` + source.replace(target, filtered)
}

export function filterBrowserSettingsPalette(source: string, root: string): string {
  const sectionTarget = '...SECTIONS.map(section => ({'
  const nonConfigTarget = '...NON_CONFIG_SETTINGS.map(entry => ({'
  if (source.split(sectionTarget).length !== 3 || source.split(nonConfigTarget).length !== 3) {
    throw new Error('Browser settings palette targets changed')
  }
  const owner = JSON.stringify(path.join(root, 'src/experience/settings/policy'))
  const dialog = '<DialogPrimitive.Content\n        aria-describedby={undefined}'
  if (source.split(dialog).length !== 2) throw new Error('Browser settings search dialog changed')
  const start = 'items: [\n          ...SECTIONS.map'
  const end = `            run: go(settingsTab(entry.tab))
          }))
        ]`
  if (source.split(start).length !== 3 || source.split(end).length !== 3) throw new Error('Browser settings palette grouping changed')
  const marketplaceGroup = `// Pinned at the top: drills into the Marketplace browser.
          {
            items: [`
  if (source.split(marketplaceGroup).length !== 2) throw new Error('Browser theme marketplace palette boundary changed')
  let browserSource = source.replace(marketplaceGroup, `// Desktop-only Marketplace search has no browser implementation.
          {
            items: window.__HERMES_WEB_BRIDGE__ ? [] : [`)
  const themePagePlaceholder = 'placeholder: t.settings.appearance.themeDesc,'
  if (browserSource.split(themePagePlaceholder).length !== 2) throw new Error('Browser theme palette placeholder boundary changed')
  browserSource = browserSource.replace(themePagePlaceholder, "placeholder: window.__HERMES_WEB_BRIDGE__ ? 'Choose an available theme.' : t.settings.appearance.themeDesc,")
  const petItems = [
    `          {\n            icon: PawPrint,\n            id: 'appearance-pets',\n            keywords: ['pet', 'petdex', 'mascot', 'pets', '/pet', 'paw'],\n            label: cc.pets.title,\n            to: 'pets'\n          },\n`,
    `          {\n            icon: Egg,\n            id: 'appearance-generate-pet',\n            keywords: ['pet', 'generate', 'create', 'make', 'new pet', 'mascot', 'hatch', 'ai'],\n            label: cc.generatePet.title,\n            run: () => openPetGenerate()\n          }\n`
  ]
  let paletteSource = browserSource
  for (const item of petItems) {
    if (paletteSource.split(item).length !== 2) throw new Error('Browser pet palette item changed')
    paletteSource = paletteSource.replace(item, '')
  }
  paletteSource = paletteSource.replace('right={page === \'pets\' ? <PetInlineToggle /> : undefined}', 'right={undefined}')
  paletteSource = paletteSource.replace(`{page === 'pets' ? (\n              <PetPalettePage\n                onGenerate={() => {\n                  closeCommandPalette()\n                  openPetGenerate()\n                }}\n                search={search}\n              />\n            ) : page === 'install-theme' ? (`, `{page === 'install-theme' ? (`)
  if (paletteSource === browserSource) throw new Error('Browser pet palette controls changed')
  return `import { isSettingsSectionVisible, presentSettingsPalette, settingsPageLabel } from ${owner}\n` + paletteSource
    .replace(dialog, dialog + "\n        data-browser-command-palette=\"\"")
    .replaceAll(start, 'items: presentSettingsPalette([\n          ...SECTIONS.map')
    .replaceAll(end, `            run: go(settingsTab(entry.tab))
          }))
        ], (tab, label) => ({ icon: Settings2, id: 'set-' + tab, label, keywords: ['settings'], run: go(settingsTab(tab)) }))`)
    .replaceAll(sectionTarget, '...SECTIONS.filter(section => isSettingsSectionVisible(section.id)).map(section => ({')
    .replaceAll(nonConfigTarget, '...NON_CONFIG_SETTINGS.filter(entry => isSettingsSectionVisible(entry.tab)).map(entry => ({')
    .replaceAll('heading: t.settings.nav.apiKeys,', "heading: settingsPageLabel('keys', t.settings.nav.apiKeys),")
}

export function removeBrowserPetAvatarTab(source: string): string {
  const option = "          { id: 'pet', label: b.avatar.tabPet }\n"
  const render = "      {tab === 'pet' ? <PetTab image={image} onImage={onImage} /> : null}\n"
  if (source.split(option).length !== 2 || source.split(render).length !== 2) {
    throw new Error('Browser pet avatar tab boundary changed')
  }
  return source.replace(option, '').replace(render, '')
}

export function removeBrowserPetSlashCommands(source: string): string {
  const commands = [
    `  {\n    name: '/pet',\n    description: 'Toggle or adopt a petdex mascot (/pet, /pet list, /pet boba)',\n    surface: action('pet'),\n    argumentMode: 'options'\n  },\n`,
    `  {\n    name: '/hatch',\n    description: 'Generate a new pet (opens the pet generator)',\n    aliases: ['/generate-pet'],\n    surface: action('hatch')\n  },\n`
  ]
  let output = source
  for (const command of commands) {
    if (output.split(command).length !== 2) throw new Error('Browser pet slash-command boundary changed')
    output = output.replace(command, '')
  }
  return output
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
  const targets = ['export function readKey(key: string): null | string {', 'export function writeKey(key: string, value: null | string) {']
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

export function filterBrowserActivityToasts(source: string): string {
  const target = '      host.notify({'
  if (source.split(target).length !== 2 || !source.includes('`${label} has new activity`')) {
    throw new Error('Browser activity notification target changed')
  }
  // Keep unread tracking and explicit incoming-message alerts, but omit the
  // generic roster activity toast that adds no information to the browser UI.
  return source.replace(target, '      if (inbound) host.notify({')
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

export function removeBrowserNewBotChatAction(source: string): string {
  if (!source.includes('b.bot.newChatWith')) return source
  const invocation = 'newBotChat(bot)'
  const start = source.lastIndexOf('<ContextMenuItem', source.indexOf(invocation))
  const close = source.indexOf('</ContextMenuItem>', source.indexOf(invocation))
  const end = close < 0 ? -1 : close + '</ContextMenuItem>'.length
  const action = start < 0 || end < 0 ? '' : source.slice(start, end)
  const imports = ["  saveSelectedRosterBot\n", "  newBotChat,\n"]
  if (!action || source.indexOf(invocation) !== source.lastIndexOf(invocation) || imports.some(target => source.split(target).length !== 2)) {
    throw new Error('Browser new-bot-chat action target changed')
  }
  let output = source.replace(action, '')
  output = output.replace(imports[0], '').replace(imports[1], '')
  output = output.replace("import { botRosterMeta, botWorkspaceOwnerKey, setBotsWorkspaceOwner } from './routing'", "import { botRosterMeta } from './routing'")
  return output
}

export function removeBrowserOpenBotChatAction(source: string): string {
  const action = '<ContextMenuItem onSelect={() => void openRosterBot(bot)}>{b.bot.openBotChat}</ContextMenuItem>'
  if (!source.includes('b.bot.openBotChat')) return source
  if (source.split(action).length !== 2) throw new Error('Browser open-bot-chat action target changed')
  return source.replace(action, '')
}

// Run after renderer compatibility has validated and transformed this module.
export function browserActivityNotificationsPlugin(root: string): Plugin {
  return {
    name: 'hermes:browser-activity-notifications', enforce: 'pre',
    transform(code, id) {
      return applyBrowserTransform(code, id, root, 40)
    }
  }
}

export function useBrowserMicrophoneCapture(source: string): string {
  const support = "    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {"
  const permission = `    const permitted = await window.hermesDesktop?.requestMicrophoneAccess?.()

    if (permitted === false) {
      throw new Error(copy.microphoneAccessDenied)
    }`
  const denied = '    return new Error(copy.microphonePermissionDenied)'
  for (const target of [support, permission, denied]) {
    if (source.split(target).length !== 2) throw new Error('Browser microphone capture target changed')
  }
  return source
    .replace(support, `    if (!window.isSecureContext) {
      throw new Error('Microphone recording requires HTTPS or localhost. Open this app using its HTTPS address, then allow microphone access.')
    }

${support}`)
    .replace(permission, `    // getUserMedia below requests browser permission and returns the recording
    // stream in one step. The desktop preflight opens and immediately closes
    // another stream, which can prompt twice or race device release.`)
    .replace(denied, `    return new Error(copy.microphoneAccessDenied + ' Allow microphone access for this site in your browser settings, then try again.')`)
}

function useBrowserComposerLayoutWidth(source: string): string {
  const target = '    const { width } = composer.getBoundingClientRect()'
  if (source.split(target).length !== 2) throw new Error('Browser composer width target changed')
  return source.replace(target, `    // Breakpoints use layout pixels; screen coordinates include browser UI zoom.
    const width = composer.offsetWidth`)
}

function replaceBrowserContract(source: string, changes: [string, string][]): string {
  for (const [before, after] of changes) {
    if (source.split(before).length !== 2) throw new Error('Browser semantic hook target changed: ' + before)
    source = source.replace(before, after)
  }
  return source
}

export function useBrowserSectionIdentity(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/experience/sidebar-sections'))
  const sessions = source.includes('interface SidebarSessionsSectionProps')
  const changes: [string, string][] = sessions ? [
    ['interface SidebarSessionsSectionProps {', 'interface SidebarSessionsSectionProps {\n  browserSectionId: string'],
    ['export function SidebarSessionsSection({', 'export function SidebarSessionsSection({\n  browserSectionId,'],
    ['}: SidebarSessionsSectionProps) {', '}: SidebarSessionsSectionProps) {\n  const browserSection = useBrowserSidebarSection(browserSectionId, label)'],
    ['<SidebarGroup className={rootClassName}>', '<SidebarGroup {...browserSection} className={rootClassName}>']
  ] : [
    ['}: SidebarCronJobsSectionProps) {', "}: SidebarCronJobsSectionProps) {\n  const browserSection = useBrowserSidebarSection('cron-jobs', label)"],
    ['<SidebarGroup className="shrink-0 p-0 pb-1">', '<SidebarGroup {...browserSection} className="shrink-0 p-0 pb-1">']
  ]
  return `import { useBrowserSidebarSection } from ${owner}\n` + replaceBrowserContract(source, changes)
}

export function useBrowserSectionIds(source: string): string {
  return replaceBrowserContract(source, [
    ['label={s.results}', 'browserSectionId="sessions" label={s.results}'],
    ['label={s.pinned}', 'browserSectionId="pinned" label={s.pinned}'],
    ['label={sessionsLabel}', 'browserSectionId="sessions" label={sessionsLabel}'],
    ['label={group.label}', 'browserSectionId={`messaging:${group.sourceId}`} label={group.label}']
  ])
}

// Suppress only the automatic desktop updater notice at its owner. Explicit
// update settings/actions and unrelated notifications keep their behavior.
export function omitBrowserDesktopUpdateNotice(source: string): string {
  const start = source.indexOf('export function maybeNotifyUpdateAvailable(')
  const end = source.indexOf('\n/**', start)
  if (start < 0 || end < 0) throw new Error('Browser update notice owner changed')
  return source.slice(0, start) + 'export function maybeNotifyUpdateAvailable(_status: DesktopUpdateStatus | null, _target: UpdateTarget = \'client\') {}\n' + source.slice(end)
}

export function useBrowserTouchHooks(source: string, root: string): string {
  const sendTarget = 'aria-label={showStop ? c.stop : c.send}'
  const labels = ['c.queueMessage', 'showStop ? c.stop : c.send', 'state.tools.label', 'copy.openModelPicker', 'triggerLabel', 'label', 'title']
  const targets = labels.map(label => `aria-label={${label}}`).filter(target => source.includes(target))
  if (!targets.length) throw new Error('Browser composer touch controls changed')
  let output = replaceBrowserContract(source, targets.map(target => [target, `${target === sendTarget ? 'data-browser-send-action="" ' : ''}${target === 'aria-label={c.queueMessage}' ? 'data-browser-queue-action="" ' : ''}data-browser-composer-action="" ${target}`]))
  if (source.includes("const tourMarker = useTourMarker('model-pill')")) {
    const marker = 'data-tour={tourMarker}'
    const matches = output.split(marker).length - 1
    if (matches !== 2) throw new Error('Browser model pill marker boundary changed')
    output = output.replaceAll(marker, `data-browser-model-pill="" ${marker}`)
  }
  if (source.includes("import { ModelPill } from './model-pill'")) {
    const importTarget = "import { ModelPill } from './model-pill'\n"
    const reasoningTarget = '              {compactModelPill ? null : <ReasoningPill disabled={disabled} model={state.model} />}\n'
    if (output.split(importTarget).length !== 2 || output.split(reasoningTarget).length !== 2) throw new Error('Browser approval composer insertion point changed')
    // Follow-up routing uses upstream's running-turn-only queue control.
    const queueTarget = "const showQueueButton = busy && busyAction !== 'stop' && hasComposerPayload"
    if (output.split(queueTarget).length !== 2) throw new Error('Browser queue control contract changed')
    output = output.replace(importTarget, `${importTarget}import { BrowserApprovalComposerControl } from ${JSON.stringify(`${root}/src/experience/browser-approval-composer-control`)}\n`)
      .replace(reasoningTarget, reasoningTarget + '              <BrowserApprovalComposerControl />\n')
  }
  return output
}

export function useBrowserAcceptedSubmit(source: string, root: string): string {
  const importTarget = 'import '
  const submitAccepted = '.then(accepted => void (accepted === false ? rejected() : clearSessionDraft(submittedScope)))'
  const steerAccepted = '.then(accepted => {\n        if (!accepted) {\n          keep()\n        }'
  if (!source.startsWith(importTarget) || source.split(submitAccepted).length !== 2 || source.split(steerAccepted).length !== 2) {
    throw new Error('Browser accepted-submit boundary changed')
  }
  const owner = JSON.stringify(path.join(root, 'src/experience/ui/accepted-submit'))
  return `import { announceBrowserAcceptedSubmit } from ${owner}\n` + source
    .replace(submitAccepted, `.then(accepted => {\n        if (accepted === false) {\n          rejected()\n        } else {\n          announceBrowserAcceptedSubmit({ text, sessionId })\n          clearSessionDraft(submittedScope)\n        }\n      })`)
    .replace(steerAccepted, `.then(accepted => {\n        if (!accepted) {\n          keep()\n        } else {\n          announceBrowserAcceptedSubmit({ text, sessionId })\n        }`)
}

/** Keep the renderer's submit/restore engine; supply the browser's follow-up policy. */
export function useBrowserFollowupSubmit(source: string, root: string): string {
  const start = '  const submitDraft = () => {'
  const payload = '    const payloadPresent = text.trim().length > 0 || attachments.length > 0'
  const policy = JSON.stringify(path.join(root, 'src/experience/followup-preferences'))
  return `import { browserFollowupMode } from ${policy}\n` + replaceBrowserContract(source, [
    [start, '  const submitDraft = (browserAlternate = false) => {'],
    [payload, `${payload}\n\n    if (busy && !queueEdit && payloadPresent && browserFollowupMode(browserAlternate) === 'queue') {\n      queueCurrentDraft()\n      focusInput()\n      return\n    }`]
  ])
}

export function useBrowserAlternateSubmit(source: string): string {
  const start = source.indexOf("    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.shiftKey) {")
  const end = source.indexOf("    if (event.key === 'Enter' && !event.shiftKey) {", start)
  if (start < 0 || end < 0) throw new Error('Browser alternate composer submit boundary changed')
  const keyboard = source.slice(start, end)
  if (keyboard.split('        queueDraft()').length !== 2) throw new Error('Browser alternate composer command changed')
  return source.slice(0, start) + keyboard.replace('        queueDraft()', '        submitDraft(true)') + source.slice(end)
}


export function removeBrowserConversationalVoiceEntry(source: string, module: 'app/chat/composer/voice-menu.tsx' | 'app/chat/composer/start-voice-button.tsx'): string {
  if (module.endsWith('voice-menu.tsx')) {
    const start = source.indexOf('        <DropdownMenuItem\n', source.indexOf('<DropdownMenuContent'))
    const end = source.indexOf('        <VoiceEngineRows', start)
    if (start < 0 || end < 0) throw new Error('Browser conversational voice menu boundary changed')
    const itemStart = source.indexOf('        <DropdownMenuSeparator />\n', start)
    if (itemStart < 0 || itemStart > end) throw new Error('Browser conversational voice separator boundary changed')
    return source.slice(0, start) + source.slice(end)
  }
  const start = source.indexOf('export function StartVoiceButton(')
  if (start < 0) throw new Error('Browser conversational voice button boundary changed')
  return 'export function StartVoiceButton(_props: { disabled: boolean; label: string; onStart: () => void }) {\n  return null\n}\n'
}

export function useBrowserCodingActionHooks(source: string): string {
  return replaceBrowserContract(source, [
    ['{resolvedRepoPath && (\n              <div ', '{resolvedRepoPath && (\n              <div data-browser-coding-path="" '],
    ['className="pointer-events-none size-4 shrink-0 text-muted-foreground/50', 'className="browser-copy-path-action pointer-events-none size-4 shrink-0 text-muted-foreground/50'],
    ['aria-label={s.newBranch}', 'data-browser-coding-action="branch" aria-label={s.newBranch}']
  ])
}

export function useBrowserSetupHooks(source: string): string {
  // These are reviewed component roots, checked by the registry at build time.
  const pattern = /<div className="fixed inset-0 z-\(--z-setup\)[^"]*">\n(\s*)<div className=/g
  const matches = [...source.matchAll(pattern)]
  const expected = source.includes('function DesktopInstallOverlay') ? 3 : 1
  if (matches.length !== expected) throw new Error('Browser setup surface changed')
  return source.replace(pattern, (match, indent) => match.replace('<div ', '<div data-browser-overlay="setup" ').replace('\n' + indent + '<div ', '\n' + indent + '<div data-browser-overlay-card="setup" '))
}

export function useBrowserSectionStyleHooks(source: string): string {
  const hooks = [
    ['<div className="group/section ', '<div data-browser-section-header="" className="group/section '],
    ['className="group/section-label ', 'data-browser-section-label="" className="group/section-label ']
  ]
  for (const [before, after] of hooks) {
    if (source.split(before).length !== 2) throw new Error('Browser section styling target changed')
    source = source.replace(before, after)
  }
  return source
}

export function trackBrowserSettingsSaves(source: string, root: string): string {
  const effectStart = '  // eslint-disable-next-line no-restricted-syntax -- autosave bookkeeping refs, not an atom mirror\n  useEffect(() => {'
  const effectEnd = '  }, [config, onConfigSaved, saveVersion, writeScope, scopeProfile])'
  const queueStart = '      saveQueueRef.current = saveQueueRef.current.then(async () => {'
  const queueEnd = '\n      })\n    }, 550)'
  const from = source.indexOf(effectStart)
  const to = source.indexOf(effectEnd, from)
  const bodyFrom = source.indexOf(queueStart, from)
  const bodyTo = source.indexOf(queueEnd, bodyFrom)
  if (from < 0 || to < 0 || bodyFrom < from || bodyTo < bodyFrom || bodyTo > to) {
    throw new Error('Browser settings autosave command boundary changed')
  }
  let body = source.slice(bodyFrom + queueStart.length, bodyTo)
  body = replaceBrowserContract(body, [
    ["          // The saved snapshot becomes the new baseline", "          // An older active-profile request must not seed the new profile's cache.\n          if (browserSettingsSave.scope !== browserSaveScope) return\n\n          // The saved snapshot becomes the new baseline"],
    ["            notifyError(err, c.autosaveFailed)\n          }", "            notifyError(err, c.autosaveFailed)\n          }\n          throw err"]
  ])
  const command = `  const saveBrowserSettingsSnapshot = (snapshot: HermesConfigRecord, v: number, browserSaveScope: number): Promise<void> => {
    saveQueueRef.current = saveQueueRef.current.catch(() => {}).then(async () => {${body}
    })
    return saveQueueRef.current
  }`
  let output = source.slice(0, from) + command + source.slice(to + effectEnd.length)
  output = replaceBrowserContract(output, [
    ['  // The editable draft is local (debounced autosave watches it), but it\'s seeded', '  // The editable draft is local (browser saves debounce its edits), but it\'s seeded'],
    ['  // B. Drop the seed + draft (re-seeds from B\'s refetch) and zero saveVersion so\n  // the pending debounced autosave is cancelled by its effect cleanup.', '  // B. Drop the seed + draft (re-seeds from B\'s refetch) and cancel unsent\n  // browser saves. Requests already in flight remain part of readiness.'],
    ["import { useEffect, useMemo, useRef, useState } from 'react'", "import { useEffect, useId, useMemo, useRef, useState } from 'react'"],
    ['  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())', `  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const browserWorkId = useId()
  const browserSettingsSave = useMemo(() => createBrowserSettingsSaveOwner(\`settings-config:\${browserWorkId}\`), [browserWorkId])`],
    ['  const [saveVersion, setSaveVersion] = useState(0)\n', ''],
    ['    setSaveVersion(0)\n    saveQueueRef.current = Promise.resolve()', '    browserSettingsSave.resetScope()\n    saveQueueRef.current = Promise.resolve()'],
    ['    setSaveVersion(saveVersionRef.current)', '    const v = saveVersionRef.current\n    const browserSaveScope = browserSettingsSave.scope\n    browserSettingsSave.schedule(() => saveBrowserSettingsSnapshot(next, v, browserSaveScope))']
  ])
  const service = JSON.stringify(path.join(root, 'src/platform/settings-save'))
  return `import { createBrowserSettingsSaveOwner } from ${service}\n${output}`
}

export function useBrowserSettingsFrame(source: string, root: string): string {
  const target = `  return (\n    <OverlayView closeLabel={t.settings.closeSettings} edgeBadge={searchPill} onClose={onClose}>\n      <OverlaySplitLayout>\n        <OverlayNav footer={navFooter} groups={navGroups} />\n\n        <OverlayMain className="px-0 pb-0">{activeSettingsContent}</OverlayMain>\n      </OverlaySplitLayout>\n    </OverlayView>\n  )`
  const replacement = `  return (\n    <BrowserSettingsFrame\n      backLabel={t.common.back}\n      closeLabel={t.settings.closeSettings}\n      footer={navFooter}\n      groups={navGroups}\n      onClose={onClose}\n      search={searchPill}\n      title={t.settings.nav.keysSettings}\n    >\n      {activeSettingsContent}\n    </BrowserSettingsFrame>\n  )`
  if (source.split(target).length !== 2) throw new Error('Browser settings frame composition contract changed')
  const frame = JSON.stringify(path.join(root, 'src/experience/settings/settings-frame'))
  return `import { BrowserSettingsFrame } from ${frame}\n${source.replace(target, replacement)}`
}

export function useBrowserProjectDisclosure(source: string): string {
  const changes: [string, string][] = [
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
  return replaceBrowserContract(source, changes)
}

export function useBrowserSearchLabel(source: string, root: string): string {
  const ariaTarget = 'aria-label={s.searchAria}'
  const placeholderTarget = 'placeholder={s.searchPlaceholder}'
  if (source.split(ariaTarget).length !== 2 || source.split(placeholderTarget).length !== 2) {
    throw new Error('Browser sidebar search label target changed')
  }
  const slotTarget = '              value={searchQuery}\n            />'
  if (source.split(slotTarget).length !== 2) throw new Error('Browser sidebar disclosure target changed')
  const extras = JSON.stringify(path.join(root, 'src/experience/sidebar-extras.tsx'))
  // Give the browser visibility preference a stable, label-independent target.
  const pinnedTarget = 'rootClassName="shrink-0 p-0 pb-1"'
  if (source.split(pinnedTarget).length !== 2) throw new Error('Browser pinned section target changed')
  const pinnedSection = '{!trimmedQuery && ('
  const pinnedSectionStart = source.lastIndexOf(pinnedSection, source.indexOf(pinnedTarget))
  if (pinnedSectionStart < 0 || !source.slice(pinnedSectionStart, source.indexOf(pinnedTarget)).includes('<SidebarSessionsSection')) throw new Error('Browser pinned section visibility target changed')
  const hooks: [string, string][] = [
    ['<div className="shrink-0 px-2 pb-1 pt-1">', '<div className="browser-session-search-section shrink-0 px-2 pb-1 pt-1">'],
    ['<SearchField', '<SearchField containerClassName="browser-session-search"'],
    ['rootClassName="min-h-32 flex-1 overflow-hidden p-0"', 'rootClassName="browser-session-list-section min-h-32 flex-1 overflow-hidden p-0"'],
    ["'min-h-32 flex-1 overflow-hidden p-0'", "'browser-session-list-section min-h-32 flex-1 overflow-hidden p-0'"]
  ]
  for (const [before, after] of hooks) {
    if (source.split(before).length !== 2) throw new Error('Browser sidebar styling target changed')
    source = source.replace(before, after)
  }
  // Use resolved pins, including backend pins, rather than DOM rows: a
  // collapsed populated section must still keep its heading visible.
  const currentPinnedTarget = source.indexOf(pinnedTarget)
  const currentPinnedStart = source.lastIndexOf(pinnedSection, currentPinnedTarget)
  if (currentPinnedStart < 0) throw new Error('Browser pinned section visibility target changed')
  source = source.slice(0, currentPinnedStart) + source.slice(currentPinnedStart).replace(pinnedSection, '{!trimmedQuery && pinnedSessions.length > 0 && (')
  return (`import { BrowserSidebarExtras } from ${extras}\n` + source)
    .replace(pinnedTarget, 'rootClassName="browser-pinned-section shrink-0 p-0 pb-1"')
    .replace(slotTarget, slotTarget + '\n            <BrowserSidebarExtras />')
    .replace(ariaTarget, "aria-label={'Search'}")
    .replace(placeholderTarget, "placeholder={'Search'}")
}

export function filterBrowserSessionMenu(source: string, root: string): string {
  const target = 'function OptionCheckbox({ checked, onCheck, option }: { checked: boolean; onCheck: () => void; option: Option }) {'
  if (source.split(target).length !== 2) throw new Error('Browser session filter menu target changed')
  const replacements: [string, string][] = [
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
    ['          {t.sidebar.markAllRead}\n', '          <Codicon name="check-all" size="0.8125rem" />\n          {browserSidebarActionLabel(\'read\', t.sidebar.markAllRead)}\n']
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
  return `import { browserSidebarActionLabel, useBrowserSidebarShortcuts } from ${owner}\n` + output.replace(target, target + hideDesktopOnlyRows)
}

export function showHiddenBotsInBrowserRoster(source: string): string {
  if (source.includes('$showHiddenBots.get()')) return source

  const importTarget = "import { isBotHidden } from './hidden-bots'\n"
  const hiddenTarget = '  const hiddenBots = roster.filter(bot => isBotHidden(bot, allMeta))\n  const visibleRoster = roster.filter(bot => !isBotHidden(bot, allMeta))'
  if (source.split(importTarget).length !== 2 || source.split(hiddenTarget).length !== 2) {
    throw new Error('Browser hidden bot roster target changed')
  }

  return source
    .replace(importTarget, importTarget + "import { $showHiddenBots } from './hidden-bots'\n")
    .replace(hiddenTarget, `  const showHiddenBots = $showHiddenBots.get()
  const hiddenBots: RosterRow[] = []
  const visibleRoster = showHiddenBots ? roster : roster.filter(bot => !isBotHidden(bot, allMeta))`)
}

export function enableBrowserUngroupedSessions(source: string, surface: 'store' | 'menu' | 'sidebar'): string {
  const replacements: Record<typeof surface, [string, string][]> = {
    store: [
      ["export const SIDEBAR_GROUPING_ORDER = ['date', 'project', 'status', 'profile'] as const", "export const SIDEBAR_GROUPING_ORDER = ['none', 'date', 'project', 'status', 'profile'] as const"],
      ["SIDEBAR_GROUPING_STORAGE_KEY,\n  'date',", "SIDEBAR_GROUPING_STORAGE_KEY,\n  'none',"],
      ["oneOf(['date', 'status'], 'date')", "oneOf(['none', 'date', 'status'], 'none')"],
      ["SIDEBAR_ALL_PROFILES_GROUPING_STORAGE_KEY,\n  'date',", "SIDEBAR_ALL_PROFILES_GROUPING_STORAGE_KEY,\n  'none',"],
      ["oneOf(['date', 'profile', 'status'], 'date')", "oneOf(['none', 'date', 'profile', 'status'], 'none')"],
      ["const SIDEBAR_DEFAULT_GROUPING: SidebarGrouping = 'date'", "const SIDEBAR_DEFAULT_GROUPING: SidebarGrouping = 'none'"]
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

export function disableBrowserSessionTabs(source: string): string {
  const keybind = '    openNewSessionTab,\n'
  const marker = '    // Browser-focused shell does not register chat tab creation.\n'
  const action = '    $newSessionTabAction.set(openNewSessionTab)'
  const disabledAction = '    $newSessionTabAction.set(null)'
  const newSession = '    onNewSessionInWorkspace: path => startSessionInWorkspace(path, { openTab: true }),'
  const browserNewSession = '    onNewSessionInWorkspace: path => startSessionInWorkspace(path),'
  const original = source.replace(marker, keybind).replace(disabledAction, action).replace(browserNewSession, newSession)
  const contract = contracts.find(item => item.module === 'app/contrib/wiring.tsx')!
  if (createHash('sha256').update(original).digest('hex') !== contract.sourceHash || original.split(keybind).length !== 2 || original.split(action).length !== 2 || original.split(newSession).length !== 2) {
    throw new Error('Browser chat tab action contract changed')
  }
  return source.replace(keybind, marker).replace(action, disabledAction).replace(newSession, browserNewSession)
}

export function disableBrowserOnboardingTips(source: string): string {
  const tipImport = "import { TipHost } from '@/components/tips'\n"
  const tipHost = '<TipHost />'
  if (source.split(tipImport).length !== 2 || source.split(tipHost).length !== 2) {
    throw new Error('Browser onboarding tip host changed')
  }
  return source.replace(tipImport, '').replace(tipHost, 'null')
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

export function useBrowserRosterSelection(source: string, root: string, surface: 'bot' | 'group' | 'created-group'): string {
  const replacements: Record<typeof surface, [string, string][]> = {
    bot: [
      ["import { openRosterBot } from './roster-actions'", ''],
      ['const open = () => void openRosterBot(bot)', 'const open = () => void selectBrowserBot(botSelectionKey(bot))']
    ],
    group: [
      ["import { GroupChatWorkspace, openGroupChat } from './group-chat-view'", "import { GroupChatWorkspace } from './group-chat-view'"],
      ['onOpen={openGroupChat}', 'onOpen={selectBrowserGroup}']
    ],
    'created-group': [
      ["import { disbandGroupChat, openGroupChat } from './group-chat-view'", "import { disbandGroupChat } from './group-chat-view'"],
      ['onCreated={groupName => openGroupChat(groupName)}', 'onCreated={selectBrowserGroup}']
    ]
  }
  let output = source
  for (const [target, replacement] of replacements[surface]) {
    if (output.split(target).length !== 2) throw new Error(`Browser ${surface} selection target changed`)
    output = output.replace(target, replacement)
  }
  const command = surface === 'bot' ? 'selectBrowserBot' : 'selectBrowserGroup'
  return `import { ${command} } from ${JSON.stringify(path.join(root, 'src/upstream/roster-selection.ts'))}\n` + output
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
    .replace(rowTarget, `${rowTarget}        data-web-session-id={session.id}\n        data-web-session-profile={session.profile || 'default'}\n`)
}

export function disableBrowserSessionOpenActions(source: string, root: string): string {
  const tabCondition = "...(surface === 'row' && !alreadyTabbed"
  const windowCondition = '...(canOpenSessionWindow()'
  const projectTarget = '        >\n          {node.label}\n        </kit.Item>'
  const contextCopyTarget = '      <CopyButton\n        appearance={kit.copyAppearance}'
  const contextProjectTarget = '      <kit.Sub>\n        <kit.SubTrigger disabled={!sessionId}>\n          <Codicon name="folder"'
  const copyImport = "import { CopyButton } from '@/components/ui/copy-button'\n"
  const contract = contracts.find(item => item.module === 'app/chat/sidebar/session-actions-menu.tsx')!
  if (createHash('sha256').update(source).digest('hex') !== contract.sourceHash || source.split(tabCondition).length !== 2 || source.split(windowCondition).length !== 2 || source.split(projectTarget).length !== 2 || source.split(contextCopyTarget).length !== 2 || source.split(contextProjectTarget).length !== 2 || source.split(copyImport).length !== 2) {
    throw new Error('Browser session open-action contract changed')
  }
  // Browser chat is single-view. Remove tab/window and copy/branch/export
  // actions while retaining session mutations and project destinations.
  const output = source.replace(tabCondition, '...(false').replace(windowCondition, '...(false')
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

export function filterBrowserKeybinds(source: string): string {
  const browserSet = `const BROWSER_UNSUPPORTED_KEYBINDS = new Set([\n  'session.newTab', 'session.newWindow', 'session.next', 'session.prev',\n  'view.showBrowser', 'view.toggleHud', 'view.showTerminal', 'view.newTerminal',\n  'view.nextTerminal', 'view.prevTerminal', 'view.closeTerminal',\n  'view.terminalCopy', 'view.terminalPaste', 'hud.snapToPointer',\n  'view.findInPage', 'view.findNext', 'view.findPrevious'\n])\n`
  const actionTarget = '  const actionList = allKeybindActions(contributions)'
  const readonlyTarget = '  const [query, setQuery] = useState(\'\')'
  if (source.includes('BROWSER_UNSUPPORTED_KEYBINDS')) return source
  const screenshotTarget = 'return <ShortcutSettings includeScreenshot={subpage === undefined} />'
  if (source.split(actionTarget).length !== 2 || source.split(readonlyTarget).length !== 2 || source.split(screenshotTarget).length !== 2) {
    throw new Error('Browser keybind contract changed')
  }
  const output = source.replace(actionTarget, `${browserSet}\n${actionTarget.replace('allKeybindActions(contributions)', 'allKeybindActions(contributions).filter(action => !BROWSER_UNSUPPORTED_KEYBINDS.has(action.id))')}`)
    .replace(readonlyTarget, "  const browserReadonly = KEYBIND_READONLY.filter(shortcut => !BROWSER_UNSUPPORTED_KEYBINDS.has(shortcut.id))\n" + readonlyTarget)
    .replaceAll('return KEYBIND_READONLY.filter', 'return browserReadonly.filter')
    .replaceAll('const readonly = KEYBIND_READONLY.filter', 'const readonly = browserReadonly.filter')
    .replace(screenshotTarget, 'return <ShortcutSettings includeScreenshot={false} />')
  if (!output.includes('BROWSER_UNSUPPORTED_KEYBINDS') || output.includes('return KEYBIND_READONLY.filter')) throw new Error('Browser keybind transform was partially modified')
  return output
}

export function browserPlugin(root: string): Plugin {
  const sourceRoot = path.resolve(root, '../desktop/src')
  return {
    name: 'hermes:browser-shell', enforce: 'pre',
    buildStart() {
      for (const contract of contracts) {
        const source = readFileSync(path.join(sourceRoot, contract.module!), 'utf8')
        if (createHash('sha256').update(source).digest('hex') !== contract.sourceHash) throw new Error(`Browser integration changed: ${contract.module}. Review the shell contract.`)
      }
      assertBrowserRoot(root)
    },
    async resolveId(source, importer) {
      const virtual = registry.find(entry => entry.kind === 'virtual-module' && entry.specifier === source)
      if (virtual) return path.join(sourceRoot, virtual.module!)
      const normalizedImporter = importer?.replaceAll('\\', '/').split('?')[0]
      const replacements = registry.filter(entry => entry.kind === 'replacement' && entry.owner.endsWith('/browser-plugin.ts') &&
        (!entry.importers || entry.importers.some(module => normalizedImporter?.endsWith('/desktop/src/' + module))))
      if (replacements.some(entry => entry.bypassImporters?.some(suffix => importer?.replaceAll('\\', '/').endsWith(suffix)))) return null
      const stem = source.replace(/\.tsx?$/, '')
      if (!replacements.some(entry => {
        const parts = entry.module!.replace(/\.tsx?$/, '').split('/')
        const names = parts.at(-1) === 'index' ? [parts.at(-2)!, parts.slice(-2).join('/')] : [parts.at(-1)!]
        return entry.specifier === source || names.some(name => stem === name || stem.endsWith('/' + name))
      })) return null
      const resolved = await this.resolve(source, importer, { skipSelf: true })
      const id = resolved?.id.replaceAll('\\', '/')
      const replacement = replacements.find(entry => id?.endsWith('/desktop/src/' + entry.module))
      if (replacement) return path.join(root, replacement.replacement!)
      return null
    },
    transform(code, id) {
      return applyBrowserTransform(code, id, root, 20)
    }
  }
}

function applyBrowserTransform(code: string, id: string, root: string, order: number): { code: string; map: null } | null {
  const normalized = id.replaceAll('\\', '/').split('?')[0]
  const entry = registry.find(item => item.kind === 'browser-transform' && item.order === order && normalized.endsWith('/desktop/src/' + item.module))
  if (!entry) return null
  const digest = (value: string) => createHash('sha256').update(root ? value.replaceAll(root, '<web-root>') : value).digest('hex')
  if (digest(code) === entry.outputHash) return { code, map: null }
  if (digest(code) !== entry.inputHash) throw new Error(`Browser compatibility changed: ${entry.name} (${entry.module}). Review this registry entry.`)
  const handlers: Record<string, (source: string) => string> = {
    useBrowserRosterDialogFocus: source => useBrowserRosterDialogFocus(source, root),
    useBrowserRosterActionSurfaces: source => useBrowserRosterActionSurfaces(source, root),
    useBrowserSectionActionSurface: source => useBrowserSectionActionSurface(source, root),
    useBrowserBotDialogFocus: source => useBrowserBotDialogFocus(source, root),
    useBrowserSectionDialogFocus: source => useBrowserSectionDialogFocus(source, root),
    keepBrowserWorkspaceRoute: source => keepBrowserWorkspaceRoute(source, root),
    respectBrowserOverlayFocusReturn: source => respectBrowserOverlayFocusReturn(source, root),
    useBrowserOverlayFocusOwner: source => useBrowserOverlayFocusOwner(source, root),
    useBrowserSettingsToolActions: source => useBrowserSettingsToolActions(source, root),
    useBrowserSettingsPresentation: source => useBrowserSettingsPresentation(source, root),
    useBrowserConfigurationSettings: source => useBrowserConfigurationSettings(source, root),
    filterBrowserSettingsFields: source => filterBrowserSettingsFields(source, root),
    useBrowserConnectingVisual,
    useBrowserProfileScopeTabs,
    keepBrowserProfileTabFocus,
    useBrowserProfileSettingsTabs: source => useBrowserProfileSettingsTabs(source, root),
    hideBrowserAppearanceOnlySettings,
    keepBrowserMessageBubblesSolid,
    hideBrowserLocalProjectDirectory,
    removeBrowserPetAvatarTab,
    removeBrowserPetSlashCommands,
    filterBrowserSettingsSearch: source => filterBrowserSettingsSearch(source, root),
    filterBrowserSettingsPalette: source => filterBrowserSettingsPalette(source, root),
    useBrowserPinWrites: source => useBrowserPinWrites(source, root),
    useBrowserOpenSessionOwner: source => useBrowserOpenSessionOwner(source, root),
    useBrowserFreshSessionOwner: source => useBrowserFreshSessionOwner(source, root),
    useBrowserDefaultSessionProfile: source => useBrowserDefaultSessionProfile(source, root),
    useBrowserDirectResumeOwner: source => useBrowserDirectResumeOwner(source),
    useBrowserSectionIdentity: source => useBrowserSectionIdentity(source, root),
    useBrowserTouchHooks: source => useBrowserTouchHooks(source, root), useBrowserAcceptedSubmit: source => useBrowserAcceptedSubmit(source, root),
    useBrowserFollowupSubmit: source => useBrowserFollowupSubmit(source, root), useBrowserAlternateSubmit,
    useBrowserCodingActionHooks, useBrowserSectionIds, omitBrowserDesktopUpdateNotice, useBrowserSetupHooks,
    removeBrowserConversationalVoiceEntry: source => removeBrowserConversationalVoiceEntry(source, entry.module as 'app/chat/composer/voice-menu.tsx' | 'app/chat/composer/start-voice-button.tsx'),
    useBrowserSectionStyleHooks, scopeBrowserStorage, filterBrowserNarrowNavigation, closeBrowserWorkspacePanels,
    useBrowserProjectDisclosure,
    exportBrowserStatusbarItem, filterBrowserActivityToasts, removeBrowserNewSessionShortcut, removeBrowserTopCapabilitiesLink,
    removeBrowserNewBotChatAction, removeBrowserOpenBotChatAction,
    useBrowserMicrophoneCapture, useBrowserComposerLayoutWidth,
    filterBrowserSessionMenu: source => filterBrowserSessionMenu(source, root),
    showHiddenBotsInBrowserRoster, disableBrowserSessionTabs, disableBrowserOnboardingTips, disableBrowserSessionTileMirrors,
    disableBrowserSessionRowTabs,
    disableBrowserSessionOpenActions: source => disableBrowserSessionOpenActions(source, root),
    filterBrowserKeybinds,
    useBrowserSessionSelection: source => useBrowserSessionSelection(source, root),
    useBrowserBotSelection: source => useBrowserRosterSelection(source, root, 'bot'),
    useBrowserGroupSelection: source => useBrowserRosterSelection(source, root, 'group'),
    useBrowserCreatedGroupSelection: source => useBrowserRosterSelection(source, root, 'created-group'),
    trackBrowserSettingsSaves: source => trackBrowserSettingsSaves(source, root),
    useBrowserSettingsFrame: source => useBrowserSettingsFrame(source, root),
    useBrowserSearchLabel: source => useBrowserSearchLabel(source, root),
    ungroupedStore: source => enableBrowserUngroupedSessions(source, 'store'),
    ungroupedMenu: source => enableBrowserUngroupedSessions(source, 'menu'),
    ungroupedSidebar: source => enableBrowserUngroupedSessions(source, 'sidebar')
  }
  let output = code
  for (const handler of entry.handlers || []) {
    if (!handlers[handler]) throw new Error(`Unknown browser compatibility handler: ${handler}`)
    output = handlers[handler](output)
  }
  if (output === code || digest(output) !== entry.outputHash) {
    throw new Error(`Incomplete browser compatibility transform: ${entry.name} (expected ${entry.outputHash}, got ${digest(output)})`)
  }
  return { code: output, map: null }
}
