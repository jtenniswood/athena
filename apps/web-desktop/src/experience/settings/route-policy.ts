import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { settingsCatalog } from './catalog'

const fullPages = new Set(['gateway', 'keybinds', 'sessions', 'config:safety', 'config:appearance', 'config:chat'])

/** Preserve query parameters and legacy bookmarks while selecting browser-owned destinations. */
export function browserSettingsDestination(search: string, nativeViews: readonly string[]) {
  const params = new URLSearchParams(search)
  const known = new Set([...nativeViews, ...settingsCatalog.flatMap(group => group.pages.map(page => page.id))])
  let view = params.get('tab') || 'config:appearance'
  if (view === 'connections') view = 'gateway'
  if (view === 'config:appearance' && params.get('page') === 'theme') { view = 'config:browser-theme'; params.delete('page') }
  if (view === 'notifications' && params.get('page') === 'sounds') { view = 'config:browser-sounds'; params.delete('page') }
  if (!known.has(view)) view = 'config:appearance'
  if (params.has('tab')) params.set('tab', view)
  return { view, search: params.toString() ? `?${params}` : '' }
}

export function useBrowserSettingsDestination<T extends string>(nativeViews: readonly T[]): readonly [T] {
  const location = useLocation(), navigate = useNavigate()
  const destination = browserSettingsDestination(location.search, nativeViews)
  useEffect(() => {
    if (destination.search !== location.search) navigate({ pathname: location.pathname, hash: location.hash, search: destination.search }, { replace: true })
  }, [destination.search, location.pathname, location.hash, location.search, navigate])
  return [destination.view as T]
}

export function browserSettingsSubpage<V extends string, T>(view: V, params: URLSearchParams, resolve: (view: V, params: URLSearchParams) => T): T | undefined {
  return fullPages.has(view) ? undefined : resolve(view, params)
}
export function browserSettingsDefaultSubpage(view: string, pages: readonly { id: string }[]): string | undefined {
  return fullPages.has(view) ? undefined : pages[0]?.id
}
export function browserSettingsChildren<T>(view: string, pages: readonly T[]): readonly T[] {
  return ['config:appearance', 'config:chat', 'notifications'].includes(view) ? [] : pages
}
