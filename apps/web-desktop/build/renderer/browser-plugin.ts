import { useBrowserSelectedSessionOwner, useBrowserOwnedSessionRpc, keepBrowserRenameProfile, scopeBrowserSessionTitles, scopeBrowserProjectTitles } from './transforms/session-routing'
import { useBrowserProjectCreateOwner, useBrowserProjectDialogOwner } from './transforms/project-create'
export { useBrowserProjectCreateOwner, useBrowserProjectDialogOwner } from './transforms/project-create'
export { useBrowserSelectedSessionOwner, useBrowserOwnedSessionRpc, keepBrowserRenameProfile, scopeBrowserSessionTitles, scopeBrowserProjectTitles } from './transforms/session-routing'
import { useBrowserThreadSubmitScroll } from './transforms/transcript'
import { useBrowserArchiveUndo } from './transforms/archive'
export { useBrowserArchiveUndo } from './transforms/archive'
export { useBrowserThreadSubmitScroll } from './transforms/transcript'
import {
  exposeBrowserConfigFieldPresentation,
  exposeBrowserSettingsRowRefs,
  keepBrowserPluginManagementInSettings,
  keepBrowserPluginInstallInSettings,
  useBrowserSettingsToolActions,
  useBrowserConfigurationSettings,
  hideBrowserAppearanceOnlySettings,
  hideBrowserLocalProjectDirectory,
  useBrowserArchivedSessionsTable,
  filterBrowserSettingsFields,
  keepBrowserProfileTabFocus,
  useBrowserProfileSettingsTabs,
  useBrowserProfileScopeTabs,
  filterBrowserSettingsSearch,
  filterBrowserSettingsPalette,
  removeBrowserPetAvatarTab,
  removeBrowserPetSlashCommands,
  trackBrowserSettingsSaves,
  useBrowserSettingsFrame,
  filterBrowserKeybinds
} from './transforms/settings'
export {
  exposeBrowserConfigFieldPresentation,
  exposeBrowserSettingsRowRefs,
  keepBrowserPluginManagementInSettings,
  keepBrowserPluginInstallInSettings,
  useBrowserSettingsToolActions,
  useBrowserConfigurationSettings,
  hideBrowserAppearanceOnlySettings,
  hideBrowserLocalProjectDirectory,
  useBrowserArchivedSessionsTable,
  filterBrowserSettingsFields,
  keepBrowserProfileTabFocus,
  useBrowserProfileSettingsTabs,
  useBrowserProfileScopeTabs,
  filterBrowserSettingsSearch,
  filterBrowserSettingsPalette,
  removeBrowserPetAvatarTab,
  removeBrowserPetSlashCommands,
  trackBrowserSettingsSaves,
  useBrowserSettingsFrame,
  filterBrowserKeybinds
} from './transforms/settings'
import {
  useBrowserMicrophoneCapture,
  guardBrowserVoiceLifetime,
  useBrowserComposerLayoutWidth,
  useBrowserTouchHooks,
  useBrowserAcceptedSubmit,
  useBrowserFollowupSubmit,
  useBrowserAlternateSubmit,
  useBrowserComposerLineBreak,
  removeBrowserConversationalVoiceEntry,
  useBrowserCodingActionHooks,
  keepBrowserMessageBubblesSolid
} from './transforms/composer'
export {
  useBrowserMicrophoneCapture,
  guardBrowserVoiceLifetime,
  useBrowserComposerLayoutWidth,
  useBrowserTouchHooks,
  useBrowserAcceptedSubmit,
  useBrowserFollowupSubmit,
  useBrowserAlternateSubmit,
  useBrowserComposerLineBreak,
  removeBrowserConversationalVoiceEntry,
  useBrowserCodingActionHooks,
  keepBrowserMessageBubblesSolid
} from './transforms/composer'
import {
  useBrowserRosterDialogFocus,
  useBrowserBotDialogFocus,
  useBrowserSectionDialogFocus,
  useBrowserRosterActionSurfaces,
  useBrowserSectionActionSurface,
  removeBrowserNewBotChatAction,
  removeBrowserOpenBotChatAction,
  removeBrowserGatewayGroupsRefresh,
  useBrowserBotsPullRefresh,
  showHiddenBotsInBrowserRoster,
  useBrowserRosterSelection
} from './transforms/roster'
export {
  useBrowserRosterDialogFocus,
  useBrowserBotDialogFocus,
  useBrowserSectionDialogFocus,
  useBrowserRosterActionSurfaces,
  useBrowserSectionActionSurface,
  removeBrowserNewBotChatAction,
  removeBrowserOpenBotChatAction,
  removeBrowserGatewayGroupsRefresh,
  useBrowserBotsPullRefresh,
  showHiddenBotsInBrowserRoster,
  useBrowserRosterSelection
} from './transforms/roster'
import {
  useBrowserMessagingPresentation,
  useBrowserFilePicker,
  useBrowserCatalogIdleTask,
  useBrowserStylesheetOwner,
  useBrowserErrorFallback,
  useBrowserConnectingVisual,
  filterBrowserActivityToasts,
  omitBrowserDesktopUpdateNotice,
  useBrowserSetupHooks,
  disableBrowserOnboardingTips
} from './transforms/host'
import {
  useBrowserSessionSection, useBrowserProjectController, useBrowserSidebarController,
  useBrowserProfileControllers, useBrowserWorkspaceController, useBrowserWorkspacePresentation,
  useBrowserRepositoryController, useBrowserCronController
} from './transforms/sidebar'
export {
  useBrowserSessionSection, useBrowserProjectController, useBrowserSidebarController,
  useBrowserProfileControllers, useBrowserWorkspaceController, useBrowserWorkspacePresentation,
  useBrowserRepositoryController, useBrowserCronController
} from './transforms/sidebar'
export {
  useBrowserMessagingPresentation,
  useBrowserFilePicker,
  useBrowserCatalogIdleTask,
  useBrowserStylesheetOwner,
  useBrowserErrorFallback,
  useBrowserConnectingVisual,
  filterBrowserActivityToasts,
  omitBrowserDesktopUpdateNotice,
  useBrowserSetupHooks,
  disableBrowserOnboardingTips
} from './transforms/host'
import {
  replaceBrowserContract
} from './transforms/contract'
export {
  replaceBrowserContract
} from './transforms/contract'
import {
  useBrowserPinWrites,
  useBrowserOpenSessionOwner,
  useBrowserFreshSessionOwner,
  useBrowserDefaultSessionProfile,
  keepBrowserWorkspaceRoute,
  useBrowserOverlayFocusOwner,
  respectBrowserOverlayFocusReturn,
  useBrowserDirectResumeOwner,
  scopeBrowserStorage,
  filterBrowserNarrowNavigation,
  closeBrowserWorkspacePanels,
  exportBrowserStatusbarItem,
  useBrowserProjectDeleteOwner,
  filterBrowserSessionMenu,
  useBrowserSessionReordering,
  enableBrowserUngroupedSessions,
  disableBrowserSessionTabs,
  disableBrowserSessionTileMirrors,
  useBrowserSessionSelection,
  disableBrowserSessionOpenActions,
  useBrowserSessionLinks,
  removeBrowserZoneTabControls,
  removeBrowserTabPaletteControl,
  removeBrowserShellTabControl
} from './transforms/navigation'
export {
  useBrowserPinWrites,
  useBrowserOpenSessionOwner,
  useBrowserFreshSessionOwner,
  useBrowserDefaultSessionProfile,
  keepBrowserWorkspaceRoute,
  useBrowserOverlayFocusOwner,
  respectBrowserOverlayFocusReturn,
  useBrowserDirectResumeOwner,
  scopeBrowserStorage,
  filterBrowserNarrowNavigation,
  closeBrowserWorkspacePanels,
  exportBrowserStatusbarItem,
  useBrowserProjectDeleteOwner,
  filterBrowserSessionMenu,
  useBrowserSessionReordering,
  enableBrowserUngroupedSessions,
  disableBrowserSessionTabs,
  disableBrowserSessionTileMirrors,
  useBrowserSessionSelection,
  disableBrowserSessionOpenActions,
  useBrowserSessionLinks,
  removeBrowserZoneTabControls,
  removeBrowserTabPaletteControl,
  removeBrowserShellTabControl
} from './transforms/navigation'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { Plugin } from 'vite'
import registry from './compatibility-registry.json'
import { useBrowserSettingsController } from './settings-controller.ts'
import { exposeBrowserTimelineHistoryOwner, useBrowserTimelineOwner, useBrowserTimelineScrubbing } from './transforms/timeline'
const contracts = registry.filter(entry => entry.sourceRoot === 'renderer' && entry.module && entry.sourceHash)

const browserRootPath = (root: string): string => path.join(root, 'src/upstream/browser-root.tsx')

function assertBrowserRoot(root: string): void {
  const rootFile = browserRootPath(root)
  if (!existsSync(rootFile)) throw new Error(`Browser root is missing: ${rootFile}`)
  const source = readFileSync(rootFile, 'utf8')
  if (!source.includes('<BrowserEngineProvider engine={browserEngine}><BrowserShell />') || source.includes('ContribController')) {
    throw new Error('Browser build root is not the browser-only shell')
  }
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
    useBrowserSelectedSessionOwner, keepBrowserRenameProfile, scopeBrowserSessionTitles, scopeBrowserProjectTitles,
    useBrowserOwnedSessionRpc: source => useBrowserOwnedSessionRpc(source, root),
    exposeBrowserTimelineHistoryOwner,
    useBrowserTimelineOwner,
    useBrowserComposerLineBreak,
    useBrowserThreadSubmitScroll: source => useBrowserThreadSubmitScroll(source, root),
    useBrowserTimelineScrubbing: source => useBrowserTimelineScrubbing(source, root),
    useBrowserSessionSection: source => useBrowserSessionSection(source, root),
    useBrowserProjectController: source => useBrowserProjectController(source, root),
    useBrowserSidebarController: source => useBrowserSidebarController(source, root),
    exposeBrowserConfigFieldPresentation: source => exposeBrowserConfigFieldPresentation(source, root),
    exposeBrowserSettingsRowRefs,
    useBrowserMessagingPresentation: source => useBrowserMessagingPresentation(source, root),
    useBrowserFilePicker: source => useBrowserFilePicker(source, root),
    useBrowserCatalogIdleTask: source => useBrowserCatalogIdleTask(source, root),
    useBrowserErrorFallback: source => useBrowserErrorFallback(source, root),
    useBrowserStylesheetOwner,
    keepBrowserPluginManagementInSettings,
    keepBrowserPluginInstallInSettings,
    useBrowserRosterDialogFocus: source => useBrowserRosterDialogFocus(source, root),
    useBrowserRosterActionSurfaces: source => useBrowserRosterActionSurfaces(source, root),
    useBrowserSectionActionSurface: source => useBrowserSectionActionSurface(source, root),
    useBrowserBotDialogFocus: source => useBrowserBotDialogFocus(source, root),
    useBrowserSectionDialogFocus: source => useBrowserSectionDialogFocus(source, root),
    keepBrowserWorkspaceRoute: source => keepBrowserWorkspaceRoute(source, root),
    respectBrowserOverlayFocusReturn: source => respectBrowserOverlayFocusReturn(source, root),
    useBrowserOverlayFocusOwner: source => useBrowserOverlayFocusOwner(source, root),
    useBrowserSettingsToolActions: source => useBrowserSettingsToolActions(source, root),
    useBrowserSettingsController: source => useBrowserSettingsController(source, root),
    useBrowserConfigurationSettings: source => useBrowserConfigurationSettings(source, root),
    filterBrowserSettingsFields: source => filterBrowserSettingsFields(source, root),
    useBrowserConnectingVisual,
    useBrowserProfileScopeTabs,
    keepBrowserProfileTabFocus,
    useBrowserProfileSettingsTabs: source => useBrowserProfileSettingsTabs(source, root),
    hideBrowserAppearanceOnlySettings,
    keepBrowserMessageBubblesSolid,
    hideBrowserLocalProjectDirectory,
    useBrowserArchivedSessionsTable: source => useBrowserArchivedSessionsTable(source, root),
    removeBrowserPetAvatarTab,
    removeBrowserPetSlashCommands,
    filterBrowserSettingsSearch: source => filterBrowserSettingsSearch(source, root),
    filterBrowserSettingsPalette: source => filterBrowserSettingsPalette(source, root),
    useBrowserPinWrites: source => useBrowserPinWrites(source, root),
    useBrowserOpenSessionOwner: source => useBrowserOpenSessionOwner(source, root),
    useBrowserFreshSessionOwner: source => useBrowserFreshSessionOwner(source, root),
    useBrowserArchiveUndo: source => useBrowserArchiveUndo(source, root),
    useBrowserDefaultSessionProfile: source => useBrowserDefaultSessionProfile(source, root),
    useBrowserDirectResumeOwner: source => useBrowserDirectResumeOwner(source),
    useBrowserTouchHooks: source => useBrowserTouchHooks(source, root), useBrowserAcceptedSubmit: source => useBrowserAcceptedSubmit(source, root),
    useBrowserFollowupSubmit: source => useBrowserFollowupSubmit(source, root), useBrowserAlternateSubmit: source => useBrowserAlternateSubmit(source, root),
    useBrowserCodingActionHooks, omitBrowserDesktopUpdateNotice, useBrowserSetupHooks,
    removeBrowserConversationalVoiceEntry: source => removeBrowserConversationalVoiceEntry(source),
    scopeBrowserStorage, filterBrowserNarrowNavigation: source => filterBrowserNarrowNavigation(source, root), closeBrowserWorkspacePanels,
    useBrowserProjectDeleteOwner: source => useBrowserProjectDeleteOwner(source, root),
    useBrowserProjectCreateOwner, useBrowserProjectDialogOwner,
    exportBrowserStatusbarItem, filterBrowserActivityToasts,
    removeBrowserNewBotChatAction, removeBrowserOpenBotChatAction,
    removeBrowserGatewayGroupsRefresh: source => removeBrowserGatewayGroupsRefresh(source, root),
    useBrowserBotsPullRefresh: source => useBrowserBotsPullRefresh(source, root),
    useBrowserMicrophoneCapture, useBrowserComposerLayoutWidth,
    guardBrowserVoiceLifetime: source => guardBrowserVoiceLifetime(source, root),
    filterBrowserSessionMenu: source => filterBrowserSessionMenu(source, root),
    showHiddenBotsInBrowserRoster, disableBrowserSessionTabs, disableBrowserOnboardingTips, disableBrowserSessionTileMirrors,
    disableBrowserSessionOpenActions: source => disableBrowserSessionOpenActions(source, root),
    filterBrowserKeybinds,
    useBrowserSessionLinks: source => useBrowserSessionLinks(source, root),
    removeBrowserZoneTabControls,
    removeBrowserShellTabControl,
    removeBrowserTabPaletteControl,
    useBrowserSessionSelection: source => useBrowserSessionSelection(source, root),
    useBrowserBotSelection: source => useBrowserRosterSelection(source, root, 'bot'),
    useBrowserGroupSelection: source => useBrowserRosterSelection(source, root, 'group'),
    useBrowserCreatedGroupSelection: source => useBrowserRosterSelection(source, root, 'created-group'),
    trackBrowserSettingsSaves: source => trackBrowserSettingsSaves(source, root),
    useBrowserSettingsFrame: source => useBrowserSettingsFrame(source, root),
    sessionReorderingSection: source => useBrowserSessionReordering(source, 'section'),
    useBrowserProfileControllers: source => useBrowserProfileControllers(source, root),
    useBrowserWorkspaceController: source => useBrowserWorkspaceController(source, root),
    useBrowserWorkspacePresentation: source => useBrowserWorkspacePresentation(source, root),
    useBrowserRepositoryController: source => useBrowserRepositoryController(source, root),
    useBrowserCronController: source => useBrowserCronController(source, root),
    sessionReorderingGroups: source => useBrowserSessionReordering(source, 'groups'),
    ungroupedStore: source => enableBrowserUngroupedSessions(source, 'store'),
    ungroupedMenu: source => enableBrowserUngroupedSessions(source, 'menu'),
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
