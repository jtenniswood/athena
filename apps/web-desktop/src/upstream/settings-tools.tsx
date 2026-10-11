import { lazy, Suspense, useContext } from 'react'
import { BrowserSettingsEmbeddedOverlay, BrowserSettingsToolActions } from '../experience/settings/embedded-overlay'

const Profiles = lazy(async () => ({ default: (await import('@/app/profiles')).ProfilesView }))
const Webhooks = lazy(async () => ({ default: (await import('@/app/webhooks')).WebhooksView }))
const Agents = lazy(async () => ({ default: (await import('@/app/agents')).AgentsView }))
const CommandCenter = lazy(async () => ({ default: (await import('@/app/command-center')).CommandCenterView }))

export const SETTINGS_TOOL_PAGES = [
  { id: 'config:profiles', label: 'Profiles', icon: 'account' },
  { id: 'config:agents', label: 'Agents', icon: 'hubot' },
  { id: 'config:webhooks', label: 'Webhooks', icon: 'globe' },
  { id: 'config:command-center', label: 'Command center', icon: 'symbol-misc' }
] as const

export function BrowserSettingsToolContent({ view, onClose }: { view: string; onClose: () => void }) {
  const actions = useContext(BrowserSettingsToolActions)
  return <BrowserSettingsEmbeddedOverlay.Provider value>
    <Suspense fallback={<p role="status">Loading…</p>}>
      {view === 'config:profiles' && <Profiles onClose={onClose} />}
      {view === 'config:webhooks' && <Webhooks onClose={onClose} />}
      {view === 'config:agents' && <Agents onClose={onClose} />}
      {view === 'config:command-center' && actions && <CommandCenter {...actions} onClose={onClose} />}
    </Suspense>
  </BrowserSettingsEmbeddedOverlay.Provider>
}
