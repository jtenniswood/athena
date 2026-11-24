import { browserPreference } from '../platform/preferences'
import type { PreferenceValues } from '../../../../scripts/browser-preference-contract.mjs'
export { DEFAULT_NAVIGATION_WIDTH, MIN_NAVIGATION_WIDTH, MAX_NAVIGATION_WIDTH, clampNavigationWidth } from '../../../../scripts/browser-preference-contract.mjs'

type NavigationPreference = Extract<keyof PreferenceValues, 'activeTab' | 'hiddenProfiles' | 'hideAllProfilesButton' | 'navigationWidth'>
/** Retain the existing wire-value interface for navigation callers. */
export function writeBrowserPreference(key: NavigationPreference, value: string): void {
  browserPreference(key).writeRaw(value)
}
export const readBotsOpen = (): boolean => browserPreference('activeTab').read() === 'bots'
export const readHiddenProfiles = (): string[] => browserPreference('hiddenProfiles').read()
export const readHideAllProfilesButton = (): boolean => browserPreference('hideAllProfilesButton').read()
export const readNavigationWidth = (): number => browserPreference('navigationWidth').read()
