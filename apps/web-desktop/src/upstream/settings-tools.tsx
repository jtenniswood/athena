import { lazy, Suspense, useContext } from 'react'
import { BrowserSettingsEmbeddedOverlay, BrowserSettingsToolActions } from '../experience/settings/embedded-overlay'
import { settingsCatalog } from '../experience/settings/catalog'

const SystemUpdates = lazy(async () => ({ default: (await import('../experience/settings/updates-page')).BrowserSystemUpdatesPage }))
const Profiles = lazy(async () => ({ default: (await import('@/app/profiles')).ProfilesView }))
const Webhooks = lazy(async () => ({ default: (await import('@/app/webhooks')).WebhooksView }))
const CommandCenter = lazy(async () => ({ default: (await import('@/app/command-center')).CommandCenterView }))

export const SETTINGS_TOOL_PAGES = settingsCatalog.flatMap(group => group.pages)
  .filter(page => page.surface === 'tool')
  .map(page => ({ id: page.id, label: page.title, icon: page.icon ?? 'settings-gear' }))

export function BrowserSettingsToolContent({ view, onClose }: { view: string; onClose: () => void }) {
  const actions = useContext(BrowserSettingsToolActions)
  return <BrowserSettingsEmbeddedOverlay.Provider value>
    <Suspense fallback={<p role="status">Loading…</p>}>
      {view === 'config:system-updates' && <SystemUpdates />}
      {view === 'config:profiles' && <Profiles onClose={onClose} />}
      {view === 'config:webhooks' && <Webhooks onClose={onClose} />}
      {view === 'config:command-center' && actions && <CommandCenter {...actions} onClose={onClose} />}
    </Suspense>
  </BrowserSettingsEmbeddedOverlay.Provider>
}
