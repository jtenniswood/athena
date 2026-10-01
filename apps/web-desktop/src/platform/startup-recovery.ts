const RETRY_KEY = 'hermes-web.startup-chunk-retry'

type RecoveryStage = 'application' | 'configuration' | 'renderer'

function stageFor(error: unknown): RecoveryStage {
  const message = error instanceof Error ? error.message : String(error || '')
  if (/runtime|gateway|configuration|environment/i.test(message)) return 'configuration'
  if (/module|chunk|import|entry/i.test(message)) return 'renderer'
  return 'application'
}

/** Render recovery without importing React, the renderer, or the gateway. */
export function showStartupRecovery(error: unknown): void {
  const root = document.getElementById('root')
  if (!root) return

  const stage = stageFor(error)
  const copy = stage === 'configuration'
    ? ['Hermes could not read its runtime configuration.', 'Your sign-in may have expired, or the web server configuration is unavailable. Retry to reconnect.']
    : stage === 'renderer'
      ? ['Hermes could not load the browser interface.', 'Reload once to retry the current build.']
      : ['Hermes could not finish starting.', 'Retry the current page. Your saved browser data was not cleared.']
  const section = document.createElement('main')
  section.className = 'hermes-startup-recovery'
  section.setAttribute('role', 'alert')
  section.innerHTML = `<h1>${copy[0]}</h1><p>${copy[1]}</p>`
  const actions = document.createElement('div')
  actions.className = 'hermes-startup-recovery-actions'
  const reconnect = document.createElement('button')
  reconnect.type = 'button'
  reconnect.textContent = stage === 'configuration' ? 'Sign in' : 'Retry'
  reconnect.onclick = () => {
    if (stage !== 'configuration') { window.location.reload(); return }
    // A cached shell can outlive proxy authentication. Reach the server as a
    // top-level navigation so its sign-in redirect can complete in the browser.
    const url = new URL(window.location.href)
    url.searchParams.set('hermes-reconnect', '1')
    window.location.assign(url.href)
  }
  actions.append(reconnect)
  section.append(actions)
  root.replaceChildren(section)
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
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.get('hermes-reconnect') === '1') {
      url.searchParams.delete('hermes-reconnect')
      window.history.replaceState(window.history.state, '', url.href)
    }
  } catch { /* The reconnect marker is harmless if history is unavailable. */ }
}
