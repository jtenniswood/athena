import { browserPreferences } from '../../../../scripts/browser-preference-contract.mjs'

const key = browserPreferences.sessionProfile.key

/** An explicit window route seeds this tab before engine stores evaluate. */
export function readBrowserTabProfile(): string | null {
  const requested = new URL(window.location.href).searchParams.get('profile')?.trim()
  if (requested) return requested
  try { return sessionStorage.getItem(key) }
  catch { return null }
}

/** Keep a routed window's reload seed aligned with its current engine owner. */
export function rememberBrowserTabProfile(profile: string): void {
  try { sessionStorage.setItem(key, profile) } catch { /* Optional tab state. */ }
  const url = new URL(window.location.href)
  if (url.searchParams.has('profile') && url.searchParams.get('profile') !== profile) {
    url.searchParams.set('profile', profile)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }
}
