import { lazy, Suspense, useContext } from 'react'
import { BrowserSettingsEmbeddedOverlay, BrowserSettingsToolActions } from '../experience/settings/embedded-overlay'

const SystemUpdates = lazy(async () => ({ default: (await import('../experience/settings/updates-page')).BrowserSystemUpdatesPage }))
const Profiles = lazy(async () => ({ default: (await import('@/app/profiles')).ProfilesView }))
const Webhooks = lazy(async () => ({ default: (await import('@/app/webhooks')).WebhooksView }))
const CommandCenter = lazy(async () => ({ default: (await import('@/app/command-center')).CommandCenterView }))

export const SETTINGS_TOOL_PAGES = [
  { id: 'config:system-updates', label: 'System updates', icon: 'cloud-download' },
  { id: 'config:profiles', label: 'Profiles', icon: 'account' },
  { id: 'config:webhooks', label: 'Webhooks', icon: 'globe' },
  { id: 'config:command-center', label: 'Command center', icon: 'symbol-misc' }
] as const

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
