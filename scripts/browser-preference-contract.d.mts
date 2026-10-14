export type NavigationTab = 'sessions' | 'bots'
export type FollowupBehavior = 'queue' | 'steer'
export type ProfileRoute = { connectionId: string | null; profile: string }
export const NAVIGATION_TABS: readonly NavigationTab[]
export const MIN_NAVIGATION_WIDTH: number
export const MAX_NAVIGATION_WIDTH: number
export const DEFAULT_NAVIGATION_WIDTH: number
export function clampNavigationWidth(width: number): number
export type PreferenceValues = {
  activeTab: NavigationTab; hiddenProfiles: string[]; hideAllProfilesButton: boolean;
  navigationTabs: NavigationTab[]; navigationWidth: number; followupBehavior: FollowupBehavior;
  auxiliaryTranscript: boolean; hiddenSections: string[]; desktopScale: number; mobileScale: number;
  defaultProfile: ProfileRoute | null; sessionProfile: string | null
}
export type PreferenceDefinition<T> = {
  key: string; owner: string; scope: 'browser' | 'session' | 'connection'; durability: 'optional' | 'required';
  defaultValue: T; parse: (raw: string | null, storage?: Pick<Storage, 'getItem'>) => T;
  serialize: (value: T) => string; changeEvent?: string; memoryOnFailure?: boolean;
  migration: { legacyKeys: readonly string[]; rule: string; transform?: (raw: string | null, storage: Pick<Storage, 'getItem'>) => { value: string; remove?: string[] } | undefined }
}
export const browserPreferences: { readonly [K in keyof PreferenceValues]: PreferenceDefinition<PreferenceValues[K]> }
export const wrapperSyncPreferenceKeys: string[]
export const browserStorageOwners: readonly { key: string; owner: string; scope: string; durability: string; parser: string; default: unknown; migration: string }[]
export function parseBrowserPreference<T>(definition: PreferenceDefinition<T>, raw: string | null, storage?: Pick<Storage, 'getItem'>): T
export function migrateBrowserPreference<T>(definition: PreferenceDefinition<T>, storage: Pick<Storage, 'getItem' | 'removeItem'>, persist: (key: string, raw: string) => void): boolean
export function createBrowserPreference<T>(definition: PreferenceDefinition<T>, environment: {
  storage: () => Pick<Storage, 'getItem'>; persist: (key: string, raw: string | null, required: boolean) => void; events: EventTarget
}): { read: () => T; write: (value: T) => void; writeRaw: (raw: string | null) => void; subscribe: (listener: () => void) => () => void }
