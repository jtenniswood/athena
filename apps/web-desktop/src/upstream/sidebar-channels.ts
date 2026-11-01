import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
import { getMessagingPlatforms } from '@/api/messaging'
import { $activeConnectionId } from '@/store/connections'
import { $gatewayState } from '@/store/session'
import { $platformsChangeTick } from '@/store/live-sync'
import { $profiles, $profileScope, ALL_PROFILES } from '@/store/profile'
import { normalizeSessionSource, sessionSourceLabel } from '@/lib/session-source'

type Channel = { key: string; label: string; sourceId: string }
const EMPTY_CHANNELS: Channel[] = []

/** Read configured channels for the same profile scope as the session sidebar. */
export function useConfiguredSidebarChannels(): Channel[] {
  const scope = useStore($profileScope)
  const profiles = useStore($profiles)
  const connection = useStore($activeConnectionId)
  const gatewayState = useStore($gatewayState)
  const changed = useStore($platformsChangeTick)
  const profileKey = JSON.stringify(scope === ALL_PROFILES ? profiles.map(profile => profile.name) : [scope])
  const scopeKey = JSON.stringify([connection, profileKey])
  const [snapshot, setSnapshot] = useState<{ scopeKey: string; channels: Channel[] } | null>(null)

  useEffect(() => {
    if (gatewayState !== 'open') return
    let cancelled = false
    let request = 0
    const refresh = async () => {
      const current = ++request
      try {
        const results = await Promise.all((JSON.parse(profileKey) as string[]).map(profile => getMessagingPlatforms(profile)))
        const channels = new Map<string, Channel>()
        for (const result of results) for (const platform of result.platforms) {
          if (!platform.enabled || !platform.configured) continue
          const sourceId = normalizeSessionSource(platform.id)
          if (!sourceId) continue
          const key = `messaging:${sourceId}`
          channels.set(key, { key, sourceId, label: sessionSourceLabel(sourceId) ?? platform.name })
        }
        // Never retain credentials, or publish a response from a previous scope.
        if (!cancelled && request === current) setSnapshot({ scopeKey, channels: [...channels.values()] })
      } catch {
        // Retain the last successful result for this scope during a transient outage.
      }
    }
    const onVisible = () => { if (!document.hidden) void refresh() }
    void refresh()
    const timer = window.setInterval(onVisible, 15000)
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [scopeKey, profileKey, gatewayState, changed])

  return snapshot?.scopeKey === scopeKey ? snapshot.channels : EMPTY_CHANNELS
}
