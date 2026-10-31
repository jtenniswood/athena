import { connectionState } from './connection-state'
import { baseUrl, browserLoginUrl, checkBrowserSession, fetchStatus, openOauthLoginPopup, resolveToken } from './connection'
import { browserSignInTarget } from './sign-in-target'
import { createSignInView } from './sign-in-view'
import { isAndroidApp } from './android'

/** Gate cold startup without evaluating upstream stores or touching saved drafts. */
export async function waitForSignIn(): Promise<void> {
  // Explicit tokens retain the renderer's existing connection/recovery path.
  if (resolveToken()) return
  const root = document.getElementById('root')
  if (!root) throw new Error('The sign-in screen could not be loaded.')
  const { section, card, status } = createSignInView('Checking your session…')
  card.insertAdjacentHTML('beforeend', `
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
      </details>`)
  const find = <T extends HTMLElement>(selector: string) => section.querySelector<T>(selector)!
  const actions = find<HTMLDivElement>('.athena-sign-in-actions')
  const signIn = find<HTMLButtonElement>('.athena-sign-in-primary')
  const currentWindow = find<HTMLButtonElement>('.athena-sign-in-current-window')
  const retry = find<HTMLButtonElement>('.athena-sign-in-retry')
  const advanced = find<HTMLDetailsElement>('details')
  const tokenInput = find<HTMLInputElement>('input')

  return new Promise(resolve => {
    let finished = false
    let busy = false
    let resuming = false
    let path = '/login'
    const preferCurrentWindow = !isAndroidApp() && (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(pointer: coarse)').matches)
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
      // Keep the original loader for an existing session. After interactive
      // sign-in, restore that same visual while the renderer starts.
      if (section.isConnected) root!.innerHTML = `<div class="hermes-startup-loading" role="status">
        <img class="hermes-startup-logo" src="/athena.svg" width="64" height="64" alt="" aria-hidden="true" />
        <span class="hermes-startup-spinner" aria-hidden="true"></span>
        <span class="hermes-startup-label">Connecting to Hermes…</span>
      </div>`
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
        const url = new URL(window.location.href)
        const returnTo = url.pathname.startsWith('//') ? '/' : `${url.pathname}${url.search}${url.hash}`
        const target = browserSignInTarget(returnTo)
        path = target.path
        signIn.textContent = target.label
        setStatus('Sign in to start chatting with Hermes Agent.')
        actions.hidden = advanced.hidden = false
        if (!section.isConnected) root!.replaceChildren(section)
      } catch {
        setStatus('Could not reach your Hermes server. Check your connection and try again.')
        retry.hidden = false
        if (!section.isConnected) root!.replaceChildren(section)
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
          currentWindow.hidden = isAndroidApp()
          setStatus(isAndroidApp() ? 'Sign-in was cancelled or did not complete. Try again.' : result.ok
            ? 'Sign-in did not complete. Try again or continue in this window.'
            : 'The sign-in window was blocked. Continue in this window to sign in.')
        }
      }).catch(() => {
        currentWindow.hidden = isAndroidApp()
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
