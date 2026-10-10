import { connectionState } from './connection-state'
import { baseUrl, browserLoginUrl, checkBrowserSession, fetchStatus, openOauthLoginPopup, resolveToken } from './connection'
import { browserSignInTarget, SignInConfigurationError, type SignInProvider } from './sign-in-target'

/** Use Hermes's public provider metadata; credentials and OIDC stay on Hermes. */
async function signInProviders(): Promise<SignInProvider[]> {
  try {
    const response = await fetch(`${baseUrl()}/api/auth/providers`, {
      credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(6_000)
    })
    if (!response.ok) return []
    const body = await response.json() as { providers?: unknown }
    if (!Array.isArray(body.providers)) return []
    return body.providers.filter((item): item is SignInProvider =>
      item && typeof item.name === 'string' && typeof item.display_name === 'string' && typeof item.supports_password === 'boolean')
  } catch { return [] }
}

/** Gate cold startup without evaluating upstream stores or touching saved drafts. */
export async function waitForSignIn(): Promise<void> {
  // Explicit tokens retain the renderer's existing connection/recovery path.
  if (resolveToken()) return
  const root = document.getElementById('root')
  if (!root) throw new Error('The sign-in screen could not be loaded.')
  const section = document.createElement('main')
  section.className = 'athena-sign-in'
  section.innerHTML = `
    <section class="athena-sign-in-card" aria-labelledby="athena-sign-in-title">
      <img class="hermes-startup-logo" src="/athena.svg" width="64" height="64" alt="" />
      <h1 id="athena-sign-in-title">Welcome to Athena</h1>
      <p class="athena-sign-in-status" role="status" aria-live="polite">Checking your session…</p>
      <div class="athena-sign-in-actions" hidden>
        <button type="button" class="athena-sign-in-primary">Sign in</button>
        <button type="button" class="athena-sign-in-current-window">Continue in this window</button>
      </div>
      <button type="button" class="athena-sign-in-retry" hidden>Retry connection</button>
      <details class="athena-sign-in-advanced" hidden>
        <summary>Use a session token</summary>
        <form>
          <label for="athena-sign-in-token">Session token</label>
          <input id="athena-sign-in-token" type="password" autocomplete="off" required />
          <button type="submit">Connect with token</button>
        </form>
      </details>
    </section>`
  const find = <T extends HTMLElement>(selector: string) => section.querySelector<T>(selector)!
  const status = find<HTMLParagraphElement>('[role="status"]')
  const actions = find<HTMLDivElement>('.athena-sign-in-actions')
  const signIn = find<HTMLButtonElement>('.athena-sign-in-primary')
  const currentWindow = find<HTMLButtonElement>('.athena-sign-in-current-window')
  const retry = find<HTMLButtonElement>('.athena-sign-in-retry')
  const advanced = find<HTMLDetailsElement>('details')
  const tokenInput = find<HTMLInputElement>('input')
  root.replaceChildren(section)

  return new Promise(resolve => {
    let finished = false
    let busy = false
    let resuming = false
    let path = '/login'
    const preferCurrentWindow = window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(pointer: coarse)').matches
    currentWindow.hidden = true

    function setStatus(message: string) {
      status.textContent = message
      status.hidden = !message
    }

    function setBusy(value: boolean) {
      busy = value
      for (const control of section.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')) control.disabled = value
      section.setAttribute('aria-busy', String(value))
    }

    function connected() {
      if (finished) return
      finished = true
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      actions.hidden = retry.hidden = advanced.hidden = true
      setStatus('Connecting to Hermes…')
      resolve()
    }

    async function check() {
      if (finished || busy) return
      setBusy(true)
      setStatus('Checking your session…')
      actions.hidden = retry.hidden = advanced.hidden = true
      try {
        const server = await fetchStatus(baseUrl())
        if (server?.auth_required === false) { connected(); return }
        if (await checkBrowserSession()) {
          connectionState().update({ authMode: 'oauth', token: '' })
          connected(); return
        }
        const providers = await signInProviders()
        const url = new URL(window.location.href)
        const returnTo = url.pathname.startsWith('//') ? '/' : `${url.pathname}${url.search}${url.hash}`
        const target = browserSignInTarget(providers, returnTo)
        path = target.path
        signIn.textContent = target.label
        setStatus('')
        actions.hidden = advanced.hidden = false
      } catch (error) {
        setStatus(error instanceof SignInConfigurationError ? error.message : 'Could not reach your Hermes server. Check your connection and try again.')
        retry.hidden = false
      } finally { if (!finished) setBusy(false) }
    }

    function navigateToSignIn() {
      setBusy(true)
      setStatus('Opening sign-in…')
      window.location.assign(browserLoginUrl(baseUrl(), path).href)
    }

    signIn.onclick = () => {
      if (busy || finished) return
      if (preferCurrentWindow) { navigateToSignIn(); return }
      setBusy(true)
      currentWindow.disabled = false
      setStatus('Complete sign-in in the window that opened.')
      // Open synchronously from the click so browsers accept the popup.
      void openOauthLoginPopup(baseUrl(), null, path).then(result => {
        if (result.connected) {
          connectionState().update({ authMode: 'oauth', token: '' })
          connected()
        } else {
          currentWindow.hidden = false
          setStatus(result.ok
            ? 'Sign-in did not complete. Try again or continue in this window.'
            : 'The sign-in window was blocked. Continue in this window to sign in.')
        }
      }).catch(() => {
        currentWindow.hidden = false
        setStatus('Sign-in could not be completed. Try again or continue in this window.')
      }).finally(() => { if (!finished) setBusy(false) })
    }
    currentWindow.onclick = navigateToSignIn
    retry.onclick = () => void check()
    find<HTMLFormElement>('form').onsubmit = event => {
      event.preventDefault()
      if (busy || finished || !tokenInput.value.trim()) return
      connectionState().update({ authMode: 'token', token: tokenInput.value.trim() })
      tokenInput.value = ''
      connected()
    }
    async function resume() {
      if (finished || busy || resuming) return
      resuming = true
      try {
        if (await checkBrowserSession() && !finished && !busy) {
          connectionState().update({ authMode: 'oauth', token: '' })
          connected()
        }
      } catch { /* Keep the sign-in screen usable when returning offline. */ }
      finally { resuming = false }
    }
    function onFocus() { void resume() }
    function onVisible() { if (document.visibilityState === 'visible') void resume() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    void check()
  })
}
