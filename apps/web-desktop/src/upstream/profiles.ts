import { useStore } from '@nanostores/react'
import { restoreUnifiedSessionList } from './session-list'
import { $activeGatewayProfile, $profileOrder, $profiles, $showAllProfiles, selectProfile, setProfileOrder, setShowAllProfiles, sortByProfileOrder } from '@/store/profile'
import { $botMeta, $lastRoster } from '@/plugins/hermes-bots/data'
import { botRosterMeta } from '@/plugins/hermes-bots/routing'
import { botAppearance } from '@/plugins/hermes-bots/avatar'
import type { BrowserProfile, BrowserProfiles } from '../experience/contracts/profiles'
import { readHiddenProfiles } from '../experience/browser-preferences'

function label(value: string) {
  const text = value.replaceAll('-', ' ').trim()
  return text ? text[0].toUpperCase() + text.slice(1) : text
}

/** Read the active renderer profile without exposing its store to browser UI. */
export function useBrowserActiveProfile(): string {
  return useStore($activeGatewayProfile)
}

/** Restore chat ownership metadata while keeping the session list unified. */
export function restoreBrowserProfile(): () => void {
  restoreUnifiedSessionList()
  window.__HERMES_WEB_ACTIVE_PROFILE__ = null
  setShowAllProfiles(true)
  try {
    const saved = sessionStorage.getItem('hermes-web.browser.profile')
    if (saved) $activeGatewayProfile.set(saved)
  } catch { /* Optional tab state. */ }
  return $activeGatewayProfile.subscribe(profile => {
    try { sessionStorage.setItem('hermes-web.browser.profile', profile) } catch { /* Optional tab state. */ }
  })
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
    fallback: all || profiles.some(profile => profile.name === active) ? null : item(active),
    select(profile) {
      if (profile === null) {
        window.__HERMES_WEB_ACTIVE_PROFILE__ = null
        setShowAllProfiles(true)
      } else selectProfile(profile)
    },
    reorder(source, target, after) {
      const names = ordered.map(profile => profile.name)
      if (source === target || !names.includes(source) || !names.includes(target)) return
      const next = names.filter(name => name !== source)
      next.splice(next.indexOf(target) + (after ? 1 : 0), 0, source)
      setProfileOrder(next)
    }
  }
}
