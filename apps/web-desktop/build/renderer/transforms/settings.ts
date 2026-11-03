import path from 'node:path'
import { replaceBrowserContract } from './contract'

export function exposeBrowserConfigFieldPresentation(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/upstream/config-field-presentation'))
  const before = '  const dataTour = `field-${schemaKey}`'
  const after = before + `
  const browserFieldRef = useBrowserConfigFieldPresentation({
    schemaKey, schema, value, enumOptions, optionLabels, label, description, onChange,
    parseList: parseListFieldDraft, prettyName,
    emptyLabel: schemaKey === 'display.personality' ? c.none : schemaKey === 'memory.provider' ? c.builtinOnly : c.noneParen,
    defaultLabel: c.systemDefault,
    extended: Boolean(descriptionExtra) || (FREE_INPUT_KEYS.has(schemaKey) && !schema.searchable)
  })`
  if (source.split(before).length !== 2 || source.split('data-tour={dataTour}').length !== 4) throw new Error('Config field presentation boundary changed')
  return `import { useBrowserConfigFieldPresentation } from ${owner}\n` + source.replace(before, after)
    .replaceAll('data-tour={dataTour}', 'data-tour={dataTour} presentationRef={browserFieldRef}')
}

export function exposeBrowserSettingsRowRefs(source: string): string {
  const listStart = source.indexOf('export function ListRow({')
  const toggleStart = source.indexOf('export function ToggleRow({')
  const toggleEnd = source.indexOf('// A quiet follow-up', toggleStart)
  if (listStart < 0 || toggleStart < listStart || toggleEnd < toggleStart) throw new Error('Settings row ownership boundary changed')
  const list = replaceBrowserContract(source.slice(listStart, toggleStart), [
    ['  className\n', '  className,\n  presentationRef\n'],
    ['  className?: string\n', '  className?: string\n  presentationRef?: Ref<HTMLDivElement>\n'],
    ["<div className={cn('@container', className)}", "<div ref={presentationRef} className={cn('@container', className)}"]
  ])
  const toggle = replaceBrowserContract(source.slice(toggleStart, toggleEnd), [
    ['  onChange,\n', '  onChange,\n  presentationRef,\n'],
    ['  onChange: (on: boolean) => void\n', '  onChange: (on: boolean) => void\n  presentationRef?: Ref<HTMLDivElement>\n'],
    ['      data-tour={dataTour}', '      data-tour={dataTour}\n      presentationRef={presentationRef}']
  ])
  return replaceBrowserContract(source.slice(0, listStart), [[
    "import type { ComponentProps, ReactNode } from 'react'", "import type { ComponentProps, ReactNode, Ref } from 'react'"
  ]]) + list + toggle + source.slice(toggleEnd)
}

export function keepBrowserPluginManagementInSettings(source: string): string {
  const target = 'const MANAGE_PLUGINS_HREF = `#${CAPABILITIES_ROUTE}?tab=plugins`'
  const params = 'export const PAGE_SCOPED_PARAMS = ['
  if (source.split(target).length !== 2 || source.split(params).length !== 2) throw new Error('Browser plugin management link changed')
  return source.replace(target, "const MANAGE_PLUGINS_HREF = '#/settings?tab=plugins&manage=1'")
    .replace(params, params + "\n  'manage',")
}

export function keepBrowserPluginInstallInSettings(source: string): string {
  return replaceBrowserContract(source, [
    ['function finishInstall(request: PluginInstallRequest, navigate: (to: string) => void)', 'function finishInstall(request: PluginInstallRequest, navigate: (to: string) => void, onSettings: boolean)'],
    ["    navigate('/capabilities?tab=plugins')", "    navigate(onSettings ? '/settings?tab=plugins&manage=1' : '/capabilities?tab=plugins')"],
    ['finishInstall(request, navigate)', 'finishInstall(request, navigate, onSettings)'],
    ['function InstallView({ request, installing, onInstallingChange }: InstallViewProps)', 'function InstallView({ request, installing, onInstallingChange, onSettings }: InstallViewProps)'],
    ['interface InstallViewProps {', 'interface InstallViewProps {\n  onSettings: boolean'],
    ['            onInstallingChange={setInstalling}', '            onInstallingChange={setInstalling}\n            onSettings={onSettings}'],
    ['    if (request && onSettings) {', '    if (request && onSettings && !window.__HERMES_WEB_BRIDGE__) {'],
    ['open={request !== null && !onSettings}', 'open={request !== null && (!onSettings || window.__HERMES_WEB_BRIDGE__)}']
  ])
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

export function hideBrowserLocalProjectDirectory(source: string): string {
  const target = 'function DefaultProjectDirSetting() {'
  if (source.split(target).length !== 2) throw new Error('Browser archived-chat directory boundary changed')
  return source.replace(target, `${target}\n  if (window.__HERMES_WEB_BRIDGE__) return null`)
}

export function useBrowserArchivedSessionsTable(source: string, root: string): string {
  const replacements: [string, string][] = [
    ['        <div className="grid gap-1">', '        <BrowserArchivedSessionsTable title={s.archivedTitle}>'],
    ['              <div className="scroll-mt-6 rounded-lg" id={`archived-session-${session.id}`} key={session.id}>\n                <ListRow', '              <BrowserArchivedSessionRow id={`archived-session-${session.id}`} key={session.id}'],
    ['                  hint={label ? `${label} · ${s.messages(session.message_count)}` : s.messages(session.message_count)}', '                  workspace={label}\n                  messageCount={session.message_count}\n                  messageLabel={s.messages(session.message_count)}'],
    ['                />\n              </div>\n            )\n          })}\n        </div>', '              />\n            )\n          })}\n        </BrowserArchivedSessionsTable>']
  ]
  let output = source
  for (const [before, after] of replacements) {
    if (output.split(before).length !== 2) throw new Error('Browser archived sessions table boundary changed')
    output = output.replace(before, after)
  }
  const owner = JSON.stringify(path.join(root, 'src/experience/settings/archived-sessions-table'))
  return `import { BrowserArchivedSessionsTable, BrowserArchivedSessionRow } from ${owner}\n` + output
}

export function filterBrowserSettingsFields(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/experience/settings/policy'))
  const target = "  ).filter(([key]) => key !== DELEGATION_ROUTE_COMPANION_KEY)"
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

export function filterBrowserKeybinds(source: string): string {
  const browserSet = `const BROWSER_UNSUPPORTED_KEYBINDS = new Set([\n  'session.newTab', 'session.newWindow', 'session.next', 'session.prev', 'view.toggleTabStrip',\n  'view.showBrowser', 'view.toggleHud', 'view.showTerminal', 'view.newTerminal',\n  'view.nextTerminal', 'view.prevTerminal', 'view.closeTerminal',\n  'view.terminalCopy', 'view.terminalPaste', 'hud.snapToPointer',\n  'view.findInPage', 'view.findNext', 'view.findPrevious'\n])\n`
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
