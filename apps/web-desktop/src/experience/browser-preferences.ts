import { browserPreference } from '../platform/preferences'
import type { PreferenceValues, NavigationTab } from '../../../../scripts/browser-preference-contract.mjs'
export { NAVIGATION_TABS, DEFAULT_NAVIGATION_WIDTH, MIN_NAVIGATION_WIDTH, MAX_NAVIGATION_WIDTH, clampNavigationWidth } from '../../../../scripts/browser-preference-contract.mjs'
export type { NavigationTab } from '../../../../scripts/browser-preference-contract.mjs'
export const NAVIGATION_TAB_LABELS: Record<NavigationTab, string> = { sessions: 'Sessions', bots: 'Bots' }

type NavigationPreference = Extract<keyof PreferenceValues, 'activeTab' | 'hiddenProfiles' | 'hideAllProfilesButton' | 'navigationTabs' | 'navigationWidth'>
/** Retain the existing wire-value interface for navigation callers. */
export function writeBrowserPreference(key: NavigationPreference, value: string): void {
  browserPreference(key).writeRaw(value)
}
export const readNavigationTab = (): NavigationTab => browserPreference('activeTab').read()
export const readVisibleNavigationTabs = (): NavigationTab[] => browserPreference('navigationTabs').read()
export const readHiddenProfiles = (): string[] => browserPreference('hiddenProfiles').read()
export const readHideAllProfilesButton = (): boolean => browserPreference('hideAllProfilesButton').read()
export const readNavigationWidth = (): number => browserPreference('navigationWidth').read()
