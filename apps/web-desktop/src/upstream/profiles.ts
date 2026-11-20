import { useStore } from '@nanostores/react'
import { $activeGatewayProfile, $profileOrder, $profiles, $showAllProfiles, setShowAllProfiles, sortByProfileOrder } from '@/store/profile'
import { $botMeta, $lastRoster } from '@/plugins/hermes-bots/data'
import { botRosterMeta } from '@/plugins/hermes-bots/routing'
import { botAppearance } from '@/plugins/hermes-bots/avatar'
import type { BrowserProfile, BrowserProfiles } from '../experience/contracts/profiles'
import { readBrowserTabProfile, rememberBrowserTabProfile } from '../platform/tab-profile'

function label(value: string) {
  const text = value.replaceAll('-', ' ').trim()
  return text ? text[0].toUpperCase() + text.slice(1) : text
}

/** Read the active renderer profile without exposing its store to browser UI. */
export function useBrowserActiveProfile(): string {
  return useStore($activeGatewayProfile)
}

/** Restore the tab's active profile and keep the sidebar in combined scope. */
export function restoreBrowserProfile(): () => void {
  setShowAllProfiles(true)
  const saved = readBrowserTabProfile()
  window.__HERMES_WEB_ACTIVE_PROFILE__ = null
  if (saved) $activeGatewayProfile.set(saved)
  const stopSavingProfile = $activeGatewayProfile.subscribe(rememberBrowserTabProfile)
  const stopScopingProfile = $showAllProfiles.listen(all => {
    if (!all) setShowAllProfiles(true)
  })
  return () => {
    stopSavingProfile()
    stopScopingProfile()
  }
}

/** A read-only profile projection with commands delegated to upstream owners. */
export function useBrowserProfiles(): BrowserProfiles {
  const profiles = useStore($profiles), order = useStore($profileOrder)
  const active = useStore($activeGatewayProfile), all = useStore($showAllProfiles)
  const roster = useStore($lastRoster), metadata = useStore($botMeta)
  const defaultProfile = profiles.find(item => item.is_default)
  const ordered = sortByProfileOrder(profiles, defaultProfile && !order.includes(defaultProfile.name) ? [defaultProfile.name, ...order] : order)
  const item = (name: string, displayName?: string): BrowserProfile => {
    const bot = roster.find(row => row.name === name || row.targetProfile === name || row.route?.targetProfile === name)
    const appearance = botAppearance(name, bot ? botRosterMeta(bot, metadata) : undefined)
    return { key: name, label: label(displayName || name), botName: bot?.name || name, appearance: { color: appearance.color ?? null, image: appearance.image ?? null, shape: appearance.shape } }
  }
  return {
    active,
    all,
    items: ordered.map(profile => item(profile.name, profile.display_name)),
    fallback: all || profiles.some(profile => profile.name === active) ? null : item(active)
  }
}
