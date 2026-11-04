/** Reuse this document only for hash navigation; query changes reload its work. */
export function routeBrowserNotification(href: string): boolean {
  try {
    if (document.getElementById('root')?.inert) return false
    const current = new URL(window.location.href)
    const target = new URL(href, current)
    if (target.origin !== current.origin || target.pathname !== current.pathname || target.search !== current.search) return false
    if (target.hash !== current.hash) window.location.hash = target.hash
    return true
  } catch { return false }
}
