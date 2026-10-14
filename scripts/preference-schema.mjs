import { wrapperSyncPreferenceKeys } from './browser-preference-contract.mjs'
// Only user preferences belong here. Never include credentials, composer
// drafts, queued messages, transcript caches, or current conversation state.
const rendererKeys = [
  'hermes-desktop-theme-v2', 'hermes-desktop-mode-v1',
  'hermes-desktop-profile-themes-v1', 'hermes-desktop-profile-modes-v1',
  'hermes-desktop-user-themes-v1', 'hermes-desktop-custom-css',
  'hermes:native-notifications',
  ...[
    'agentsGroupedByWorkspace', 'alwaysExternalLinks.v1', 'autoSpeakReplies',
    'backdrop.v1', 'chat-text-scale.v1', 'collapsed-providers',
    'collapsedStatusDrawers.v1', 'collapsedTreeSides.v1', 'completionSoundVariantId',
    'custom-models', 'disableF12.v1', 'dismissedPanes.v1', 'favorite-models',
    'floatingPanes.v1', 'hapticsMuted', 'hiddenStripTabs.v1', 'hideThreadTimeline',
    'interfaceMode.v1', 'intro-splash.v1', 'keepAwake', 'keepAwakeMode', 'keybinds',
    'layoutModeScopes.v1', 'layoutPreset.active', 'layoutPresets.v2', 'layoutTree.v2',
    'mdTableColumns.v1', 'metrics.v1', 'model-presets', 'model-pricing.v1',
    'paneShare.v1', 'paneSharePartners.v1', 'paneStates.v1', 'panesFlipped',
    'profileColors', 'profileOrder', 'profileRailVisible', 'projectOrder',
    'reasoning.collapsedByDefault', 'reactions.v1', 'reviewCommitDefault', 'reviewTreeMode',
    'rightRailActiveTab', 'sessionColors', 'sessionListDensity', 'sessionOrder',
    'sessionOrder.manual', 'showAllProfiles', 'sidebarAgentsGrouped.allProfiles',
    'sidebarCardRows', 'sidebarCronOpen', 'sidebarGrouping', 'sidebarGrouping.allProfiles',
    'sidebarMessagingOpen', 'sidebarPrFilter', 'sidebarProfileFilter',
    'sidebarProjectFilter', 'sidebarRowMeta', 'sidebarShowAllSessions',
    'sidebarShowArchived', 'sidebarSortKey', 'sidebarStatusFilter',
    'statusbarHidden.v2', 'statusbarVisible.v2', 'tabStripDefault', 'textDirection',
    'titlebarAppActions', 'toolView.hideCodeDiffs', 'toolView.technical',
    'translucency.v2', 'user-bubble-transparency.v1', 'userPlacedPanes.v1',
    'videoPlaybackSpeed', 'visible-models', 'workspaceCollapsed', 'workspaceNodeOpen',
    'workspaceOrder', 'workspaceParentOrder'
  ].map(key => `hermes.desktop.${key}`)
]
// Match the existing browser storage adapter's namespace, without changing it.
const scoped = /^hermes\.desktop\.(?:layout|pane|sidebar|fileBrowser|rightRail|profileRail|terminal|statusbar|hiddenStrip|dismissedPanes|userPlaced)/
const layoutKeys = new Set([
  'floatingPanes.v1', 'layoutTree.v2', 'layoutPreset.active', 'paneStates.v1',
  'dismissedPanes.v1', 'paneShare.v1', 'paneSharePartners.v1', 'hiddenStripTabs.v1',
  'userPlacedPanes.v1', 'panesFlipped', 'collapsedTreeSides.v1'
].map(key => `hermes.desktop.${key}`))
export const preferenceKeys = [
  ...rendererKeys.flatMap(key => layoutKeys.has(key) ? [key, `${key}.simple`] : [key])
    .map(key => scoped.test(key) ? `hermes-web.browser.${key}` : key),
  ...wrapperSyncPreferenceKeys,
  'hermes.plugin.hermes-bots.activity-toasts', 'hermes.plugin.hermes-bots.bot-sections-v1'
]
const allowedKeys = new Set(preferenceKeys)
export const MAX_PREFERENCE_BYTES = 1024 * 1024
export function isPreferenceKey(key) { return allowedKeys.has(key) }
export function validatePreferenceValues(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Invalid preferences')
  for (const [key, value] of Object.entries(values)) {
    if (!isPreferenceKey(key) || (value !== null && typeof value !== 'string') || (value?.length ?? 0) > 128 * 1024) {
      throw new Error('Invalid preference key or value')
    }
  }
  if (new TextEncoder().encode(JSON.stringify(values)).length > MAX_PREFERENCE_BYTES) throw new Error('Preferences are too large')
  return values
}
