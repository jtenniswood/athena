let releaseCurrent: (() => void) | undefined

/** Admit one page transition; only its owner may restore interaction. */
export function beginBrowserTransition(): (() => void) | undefined {
  const root = document.getElementById('root')
  if (!root || root.inert || releaseCurrent) return undefined
  const release = () => {
    if (releaseCurrent !== release) return
    releaseCurrent = undefined
    root.inert = false
  }
  releaseCurrent = release
  root.inert = true
  return release
}
