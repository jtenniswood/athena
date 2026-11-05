import { connectionState } from './connection-state'
import { reloadReadinessAfterSaving } from './reload-safety'
import { beginBrowserTransition } from './browser-transition'
import { usesOfficialWebappHost } from './official-host'
import { browserSignInTarget } from './sign-in-target'

/** Save pending work before ending the session and returning to cold startup. */
export async function signOut(): Promise<void> {
  const release = beginBrowserTransition()
  if (!release) return
  try {
    const readiness = await reloadReadinessAfterSaving()
    if (!readiness.ready) throw new Error(readiness.reason)

    const result = await window.hermesDesktop.oauthLogoutConnectionConfig(window.location.origin)
    if (!result.ok) throw new Error('Sign-out failed. Try again.')

    // Background work can change while logout is pending; verify again before leaving.
    const latest = await reloadReadinessAfterSaving()
    if (!latest.ready) throw new Error(latest.reason)

    if (!usesOfficialWebappHost()) {
      const state = connectionState()
      state.update({ authMode: 'oauth', token: '' })
      if (!state.persisted()) throw new Error('Your saved sign-in could not be cleared. Check browser storage and try again.')
    }
    if (usesOfficialWebappHost()) {
      const { pathname, search, hash } = window.location
      window.location.assign(browserSignInTarget(pathname + search + hash).path)
    } else window.location.reload()
  } catch (error) { release(); throw error }
}
