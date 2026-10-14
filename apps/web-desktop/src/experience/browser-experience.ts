import { browserPreferences, migrateBrowserPreference } from '../../../../scripts/browser-preference-contract.mjs'

export function initializeBrowserExperience(): void {
  document.documentElement.dataset.experience = 'browser'
  try {
    migrateBrowserPreference(browserPreferences.sessionProfile, sessionStorage, (key, value) => sessionStorage.setItem(key, value))
  } catch {
    // Browser storage is optional; the active profile can still be selected in memory.
  }
}
