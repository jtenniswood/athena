let releaseCurrent: (() => void) | undefined

/** Admit one page transition; only its owner may restore interaction. */
export function beginBrowserTransition(): (() => void) | undefined {
  const root = document.getElementById('root')
  const body = document.body
  if (!root || !body || root.inert || body.inert || releaseCurrent) return undefined
  const release = () => {
    if (releaseCurrent !== release) return
    releaseCurrent = undefined
    root.inert = false
    body.inert = false
  }
  releaseCurrent = release
  root.inert = true
  // Engine menus and dialogs can be portaled outside the application root.
  body.inert = true
  return release
}
