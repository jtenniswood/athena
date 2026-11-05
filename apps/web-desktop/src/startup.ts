import { initializeBrowserExperience } from './experience/browser-experience'
import { consumeConnectionToken } from './platform/connection-state'
import { trackMediaRequests } from './platform/reload-safety'
import { runtimeConfig } from './platform/runtime'
import { initializePreferenceSync } from './platform/preference-sync'
import { waitForSignIn } from './platform/sign-in'
import { registerPwa } from './pwa/register'
import { startBrowserHost } from './upstream/entry'

/** Called once per page load; entry.ts owns startup completion and recovery. */
export async function startBrowserApplication(): Promise<void> {
  registerPwa()
  runtimeConfig()
  trackMediaRequests()
  consumeConnectionToken()
  await waitForSignIn()
  await initializePreferenceSync()
  initializeBrowserExperience()

  // The host owns bridge assembly and renderer evaluation. Browser services
  // and credentials must be ready before any engine module reads them.
  await startBrowserHost()
}
