/** Bind a chat's owner to its hash route, independently of the window's profile filter. */
export function withBrowserSessionProfile(target: URL, profile?: string | null): URL {
  const url = new URL(target)
  const owner = profile?.trim()
  if (!owner) return url
  const route = url.hash.slice(1), split = route.indexOf('?')
  const pathname = split < 0 ? route : route.slice(0, split)
  const query = new URLSearchParams(split < 0 ? '' : route.slice(split + 1))
  query.set('profile', owner)
  url.hash = `${pathname}?${query}`
  // Seed the first connection before stores evaluate. Later filter changes may
  // update this query without changing the owner retained in the chat route.
  url.searchParams.set('profile', owner)
  return url
}

export function browserSessionRouteProfile(url: URL): string | null {
  const split = url.hash.indexOf('?')
  if (split < 0) return null
  return new URLSearchParams(url.hash.slice(split + 1)).get('profile')?.trim() || null
}
