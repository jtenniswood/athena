import { $activeGatewayProfile, $newChatRoute, $profileOrder, $profiles, $showAllProfiles, ensureGatewayAgent, pinNewChatProfile, sortByProfileOrder, type AgentProfileRoute } from '@/store/profile'
import { WEB_CONNECTION_ID } from '../platform/connection'
import { readHiddenProfiles } from '../experience/browser-preferences'
import { reportActionFailure } from '../experience/action-errors'

/** Generic creation in All profiles uses the first enabled profile in rail order. */
export function defaultNewSessionTarget(): { profile: string; route: AgentProfileRoute } | null {
  if (!$showAllProfiles.get()) return null
  const profiles = $profiles.get()
  const order = $profileOrder.get()
  const defaultProfile = profiles.find(profile => profile.is_default)
  const ordered = sortByProfileOrder(profiles, defaultProfile && !order.includes(defaultProfile.name) ? [defaultProfile.name, ...order] : order)
  const hidden = readHiddenProfiles()
  const first = ordered.find(profile => !hidden.includes(profile.name))
  if (!first) return null
  return { profile: first.name, route: { connectionId: WEB_CONNECTION_ID, profile: first.name } }
}

/** Capture the preferred owner before starting a new draft. */
export function prepareDefaultNewSession(): void {
  const target = defaultNewSessionTarget()
  if (!target) {
    // An ordinary new session must release a previous draft's explicit owner.
    pinNewChatProfile($activeGatewayProfile.get())
    return
  }
  pinNewChatProfile(target.profile)
  $newChatRoute.set(target.route)
  // Capture before opening the draft; the eventual Send keeps this exact owner.
  void ensureGatewayAgent(target.route.connectionId, target.profile).catch(() => {
    reportActionFailure('Could not open the default profile for new sessions.')
  })
}
