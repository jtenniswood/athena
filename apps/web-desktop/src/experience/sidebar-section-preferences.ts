import { browserPreferences, parseBrowserPreference } from '../../../../scripts/browser-preference-contract.mjs'
export const HIDDEN_SECTIONS_KEY = browserPreferences.hiddenSections.key
export function readHiddenSections(storage: Pick<Storage, 'getItem'>): string[] {
  try { return parseBrowserPreference(browserPreferences.hiddenSections, storage.getItem(HIDDEN_SECTIONS_KEY), storage) }
  catch { return [] }
}
