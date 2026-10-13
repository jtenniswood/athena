import { createSignInView } from './sign-in-view'

const RETRY_KEY = 'hermes-web.startup-chunk-retry'
const RETURN_HASH_KEY = 'athena.startup-return-hash'

type RecoveryStage = 'application' | 'configuration' | 'renderer'

function stageFor(error: unknown): RecoveryStage {
  const message = error instanceof Error ? error.message : String(error || '')
  if (/runtime|gateway|configuration|environment/i.test(message)) return 'configuration'
  if (/module|chunk|import|entry/i.test(message)) return 'renderer'
  return 'application'
}

function safeRevision(revision: string): string {
  return String(revision || 'unknown').replace(/[^a-z0-9._-]/gi, '').slice(0, 80) || 'unknown'
}

/** Render recovery without importing React, the renderer, or the gateway. */
export function showStartupRecovery(error: unknown, revision: string): void {
  const root = document.getElementById('root')
  if (!root) return

  const stage = stageFor(error)
  const wrapperRevision = safeRevision(revision)
  if (stage === 'configuration') {
    // Configuration may be behind expired proxy authentication. Its login
    // route is unknown until configuration loads, so navigate to this page
    // through the server instead of guessing a Hermes authentication route.
    const url = new URL(window.location.href)
    const reconnecting = url.searchParams.get('hermes-reconnect') === '1'
    const { section, card, status } = createSignInView(reconnecting
      ? 'Athena is still unavailable. Check your connection and try again.'
      : '')
    const signIn = document.createElement('button')
    signIn.type = 'button'
    signIn.className = 'athena-sign-in-primary'
    signIn.textContent = reconnecting ? 'Retry connection' : 'Sign in'
    signIn.onclick = () => {
      signIn.disabled = true
      section.setAttribute('aria-busy', 'true')
      status.textContent = reconnecting ? 'Reconnecting…' : 'Opening sign-in…'
      status.hidden = false
      try { sessionStorage.setItem(RETURN_HASH_KEY, url.hash) } catch { /* Navigation remains available without storage. */ }
      url.searchParams.set('hermes-reconnect', '1')
      if (url.href === window.location.href) window.location.reload()
      else window.location.assign(url.href)
    }
    card.append(signIn)
    root.replaceChildren(section)
    return
  }
  const copy = stage === 'renderer'
    ? ['Hermes could not load the browser interface.', 'Reload once to retry the current build.']
    : ['Hermes could not finish starting.', 'Retry the current page. Your saved browser data was not cleared.']
  const section = document.createElement('main')
  section.className = 'hermes-startup-recovery'
  section.setAttribute('role', 'alert')
  section.innerHTML = `<h1>${copy[0]}</h1><p>${copy[1]}</p><p class="hermes-startup-recovery-meta">Build ${wrapperRevision}</p>`
  const actions = document.createElement('div')
  actions.className = 'hermes-startup-recovery-actions'
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.textContent = 'Retry'
  retry.onclick = () => window.location.reload()
  actions.append(retry)
  actions.append(diagnosticsButton(stage, wrapperRevision))
  section.append(actions)
  root.replaceChildren(section)
}

function diagnosticsButton(stage: RecoveryStage, wrapperRevision: string): HTMLButtonElement {
  const copyButton = document.createElement('button')
  copyButton.type = 'button'
  copyButton.textContent = 'Copy diagnostics'
  copyButton.onclick = () => {
    const diagnostics = `Athena startup failure\nStage: ${stage}\nBuild: ${wrapperRevision}`
    void navigator.clipboard?.writeText(diagnostics)
  }
  return copyButton
}

/** A navigation can abort a module fetch while the browser cache/worker changes.
 * Retry a failed initial import once, before any composer has mounted. A second
 * failure keeps the explicit recovery screen; unavailable storage never loops. */
export function recoverStartupChunk(error: unknown, revision: string): boolean {
  if (!(error instanceof Error) || !/Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(error.message)) return false
  try {
    if (sessionStorage.getItem(RETRY_KEY) === revision) return false
    sessionStorage.setItem(RETRY_KEY, revision)
    if (sessionStorage.getItem(RETRY_KEY) !== revision) return false
  } catch { return false }
  window.location.reload()
  return true
}
export function completeStartup(): void {
  try { sessionStorage.removeItem(RETRY_KEY) } catch { /* Optional recovery marker. */ }
  try { sessionStorage.removeItem(RETURN_HASH_KEY) } catch { /* Optional return location. */ }
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.get('hermes-reconnect') === '1') {
      url.searchParams.delete('hermes-reconnect')
      window.history.replaceState(window.history.state, '', url.href)
    }
  } catch { /* The reconnect marker is harmless if history is unavailable. */ }
}

/** Proxy login links can drop fragments; restore the conversation before chat loads. */
export function restoreStartupLocation(): void {
  try {
    const url = new URL(window.location.href)
    const hash = sessionStorage.getItem(RETURN_HASH_KEY)
    if (url.searchParams.get('hermes-reconnect') !== '1' || url.hash || !hash?.startsWith('#/')) return
    url.hash = hash
    window.history.replaceState(window.history.state, '', url.href)
  } catch { /* Optional return location must never block startup. */ }
}
