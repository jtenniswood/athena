import { initializeBrowserExperience } from './experience/browser-experience'
import { consumeConnectionToken } from './platform/connection-state'
import { trackMediaRequests } from './platform/reload-safety'
import { runtimeConfig } from './platform/runtime'
import { initializePreferenceSync } from './platform/preference-sync'
import { waitForSignIn } from './platform/sign-in'
import { registerPwa } from './pwa/register'
import { startBrowserHost } from './upstream/entry'
import { usesOfficialWebappHost } from './platform/official-host'
import type { PreferenceSyncOptions } from './platform/preference-sync'
import { migrateOfficialComposerPreferences } from './platform/official-migration'

/** Called once per page load; entry.ts owns startup completion and recovery. */
export async function startBrowserApplication(): Promise<void> {
  registerPwa()
  runtimeConfig()
  trackMediaRequests()
  let preferenceOwnership: PreferenceSyncOptions | undefined
  if (usesOfficialWebappHost()) {
    const { initializeOfficialBrowserTransport, officialPreferenceOwnership } = await import('./upstream/official-startup')
    await initializeOfficialBrowserTransport()
    preferenceOwnership = officialPreferenceOwnership()
  } else {
    consumeConnectionToken()
    await waitForSignIn()
  }
  await initializePreferenceSync(preferenceOwnership)
  if (usesOfficialWebappHost()) {
    try { migrateOfficialComposerPreferences(localStorage, window.location.origin) }
    catch { /* Existing choices remain available when optional browser storage is full. */ }
  }
  initializeBrowserExperience()

  // The host owns bridge assembly and renderer evaluation. Browser services
  // and credentials must be ready before any engine module reads them.
  await startBrowserHost()
}
