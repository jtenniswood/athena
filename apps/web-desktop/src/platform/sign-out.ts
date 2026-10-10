import { connectionState } from './connection-state'
import { reloadReadinessAfterSaving } from './reload-safety'

/** Save pending work before ending the session and returning to cold startup. */
export async function signOut(): Promise<void> {
  const readiness = await reloadReadinessAfterSaving()
  if (!readiness.ready) throw new Error(readiness.reason)

  const result = await window.hermesDesktop.oauthLogoutConnectionConfig(window.location.origin)
  if (!result.ok) throw new Error('Sign-out failed. Try again.')

  // The user may have edited their draft while the logout request was pending.
  const latest = await reloadReadinessAfterSaving()
  if (!latest.ready) throw new Error(latest.reason)

  const state = connectionState()
  state.update({ authMode: 'oauth', token: '' })
  if (!state.persisted()) throw new Error('Your saved sign-in could not be cleared. Check browser storage and try again.')
  window.location.reload()
}
