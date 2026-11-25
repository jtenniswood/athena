import { isAndroidApp } from './android'
import { beginBrowserTransition } from './browser-transition'
import { baseUrl, browserLoginUrl, checkBrowserSession, resolveToken } from './connection'
import { reloadReadinessAfterSaving } from './reload-safety'
import { browserReturnPath, browserSignInTarget } from './sign-in-target'
import { navigateThroughProxy } from './startup-recovery'

type SignInRequirement = 'proxy' | 'hermes' | null
const SESSION_CHECK_INTERVAL = 30_000
const API_FAILURE_CHECK_INTERVAL = 2_000
const CHECK_SESSION_EVENT = 'athena:check-browser-session'

export function requestBrowserSessionCheck(): void {
  window.dispatchEvent(new Event(CHECK_SESSION_EVENT))
}

function sessionProbe(url: string): Promise<Response> {
  return fetch(url, {
    cache: 'no-store', credentials: 'same-origin', redirect: 'manual', signal: AbortSignal.timeout(6_000)
  })
}

async function isProxySignIn(response: Response): Promise<boolean> {
  if (response.type === 'opaqueredirect') return true
  return response.headers.get('content-type')?.startsWith('text/html') === true &&
    /<title[^>]*>[^<]*Cloudflare Access[^<]*<\/title>/i.test(await response.text())
}

async function requiredSignIn(): Promise<SignInRequirement> {
  const response = await sessionProbe(`${baseUrl()}/api/status`)
  if (await isProxySignIn(response)) {
    // The runtime script is served by Athena and has no gateway redirects.
    // A sign-in challenge there also affects a top-level app navigation.
    const runtime = await sessionProbe('/runtime-config.js')
    if (await isProxySignIn(runtime)) return 'proxy'
    throw new Error('The gateway status request was redirected.')
  }
  if (!response.ok) throw new Error('The server status is unavailable.')
  const status = await response.json() as { auth_required?: boolean }
  return status?.auth_required === true && !resolveToken() && !await checkBrowserSession() ? 'hermes' : null
}

/** Recheck a live tab when it comes back into use or loses API access. */
export function monitorBrowserSession(): void {
  let checking = false
  let leaving = false
  let nextFailureCheck = 0
  let failureTimer: number | undefined
  let notice: HTMLElement | undefined

  function showNotice(reason: string) {
    if (!notice) {
      notice = document.createElement('aside')
      notice.className = 'athena-session-recovery'
      const message = document.createElement('p')
      message.setAttribute('role', 'status')
      const signIn = document.createElement('button')
      signIn.type = 'button'
      signIn.textContent = 'Sign in again'
      signIn.onclick = () => void check()
      notice.append(message, signIn)
      document.body.append(notice)
    }
    const message = notice.querySelector('p')!
    const text = `Your session has expired. ${reason}`
    if (message.textContent !== text) message.textContent = text
  }

  async function check() {
    if (checking || leaving || document.visibilityState !== 'visible') return
    window.clearTimeout(failureTimer)
    failureTimer = undefined
    checking = true
    nextFailureCheck = Date.now() + API_FAILURE_CHECK_INTERVAL
    try {
      const requirement = await requiredSignIn()
      if (!requirement) {
        notice?.remove()
        notice = undefined
        return
      }
      if (document.visibilityState !== 'visible') return
      const release = beginBrowserTransition()
      if (!release) return
      try {
        // The same gateway can resume active turns after sign-in, as it does
        // after a UI update. Local attachments and media still block navigation.
        const readiness = await reloadReadinessAfterSaving('ui-update')
        if (!readiness.ready) {
          showNotice(readiness.reason)
          return
        }
        if (document.visibilityState !== 'visible' || (requirement === 'hermes' && resolveToken())) return
        if (requirement === 'proxy') navigateThroughProxy()
        else if (isAndroidApp()) window.location.reload()
        else window.location.replace(browserLoginUrl(baseUrl(), browserSignInTarget(browserReturnPath()).path).href)
        leaving = true
      } finally { if (!leaving) release() }
    } catch { /* Offline or an unhealthy gateway: recheck when it is reachable. */ }
    finally { checking = false }
  }

  window.addEventListener(CHECK_SESSION_EVENT, () => {
    if (leaving || failureTimer !== undefined || document.visibilityState !== 'visible') return
    failureTimer = window.setTimeout(() => {
      failureTimer = undefined
      void check()
    }, Math.max(0, nextFailureCheck - Date.now()))
  })
  window.addEventListener('focus', () => void check())
  document.addEventListener('visibilitychange', () => void check())
  window.setInterval(() => void check(), SESSION_CHECK_INTERVAL)
}
