import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
import { $activeGatewayProfile, $profileOrder, $profiles, $showAllProfiles, selectProfile, setProfileOrder, setShowAllProfiles, sortByProfileOrder } from '@/store/profile'
import { $botMeta, $lastRoster } from '@/plugins/hermes-bots/data'
import { botRosterMeta } from '@/plugins/hermes-bots/routing'
import { botAppearance } from '@/plugins/hermes-bots/avatar'
import type { BrowserProfile, BrowserProfiles } from '../experience/contracts/profiles'
import { browserDefaultProfile } from '../platform/browser-default-profile'
import { WEB_CONNECTION_ID } from '../platform/connection'
import { reportActionFailure } from '../experience/action-errors'
import { readHiddenProfiles } from '../experience/browser-preferences'

function label(value: string) {
  const text = value.replaceAll('-', ' ').trim()
  return text ? text[0].toUpperCase() + text.slice(1) : text
}

/** Read the active renderer profile without exposing its store to browser UI. */
export function useBrowserActiveProfile(): string {
  return useStore($activeGatewayProfile)
}

/** Restore the tab's profile without changing its persisted all-profiles scope. */
export function restoreBrowserProfile(): () => void {
  let saved: string | null = null
  try {
    saved = sessionStorage.getItem('hermes-web.browser.profile')
  } catch { /* Optional tab state. */ }
  if (saved) {
    window.__HERMES_WEB_ACTIVE_PROFILE__ = $showAllProfiles.get() ? null : saved
    $activeGatewayProfile.set(saved)
  } else {
    window.__HERMES_WEB_ACTIVE_PROFILE__ = null
    setShowAllProfiles(true)
  }
  const hiddenProfiles = readHiddenProfiles()
  let stopSelectingDefault: (() => void) | undefined
  const chooseVisibleDefault = (profiles: ReturnType<typeof $profiles.get>) => {
    const defaultProfile = profiles.find(profile => profile.is_default)
    if (!defaultProfile) return
    if (!hiddenProfiles.includes(defaultProfile.name)) {
      stopSelectingDefault?.()
      return
    }
    if (!$showAllProfiles.get() && !hiddenProfiles.includes($activeGatewayProfile.get())) {
      stopSelectingDefault?.()
      return
    }
    const order = $profileOrder.get()
    const ordered = sortByProfileOrder(
      [...profiles],
      !order.includes(defaultProfile.name) ? [defaultProfile.name, ...order] : order
    )
    const next = ordered.find(profile => !hiddenProfiles.includes(profile.name))
    if (!next) return
    window.__HERMES_WEB_ACTIVE_PROFILE__ = next.name
    selectProfile(next.name)
    stopSelectingDefault?.()
  }
  stopSelectingDefault = $profiles.listen(profiles => chooseVisibleDefault([...profiles]))
  chooseVisibleDefault($profiles.get())
  const stopSavingProfile = $activeGatewayProfile.subscribe(profile => {
    try { sessionStorage.setItem('hermes-web.browser.profile', profile) } catch { /* Optional tab state. */ }
  })
  return () => {
    stopSelectingDefault?.()
    stopSavingProfile()
  }
}

/** A read-only profile projection with commands delegated to upstream owners. */
export function useBrowserProfiles(): BrowserProfiles {
  const [defaultRoute, setDefaultRoute] = useState(browserDefaultProfile.getSnapshot)
  useEffect(() => browserDefaultProfile.onDefaultChanged(setDefaultRoute), [])
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
    defaultNewSessionProfile: profiles.some(profile => profile.name === defaultRoute?.profile) ? defaultRoute!.profile : null,
    items: ordered.map(profile => item(profile.name, profile.display_name)),
    fallback: all || profiles.some(profile => profile.name === active) ? null : item(active),
    setDefaultNewSessionProfile(profile) {
      const save = profile === null
        ? browserDefaultProfile.clearDefault()
        : browserDefaultProfile.setDefault({ connectionId: WEB_CONNECTION_ID, profile })
      void save.catch(() => reportActionFailure('Could not save the default profile for new sessions.'))
    },
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
