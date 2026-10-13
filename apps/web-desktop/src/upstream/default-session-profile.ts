import { $activeGatewayProfile, $newChatRoute, $profiles, $showAllProfiles, ensureGatewayAgent, pinNewChatProfile, type AgentProfileRoute } from '@/store/profile'
import { browserDefaultProfile } from '../platform/browser-default-profile'
import { reportActionFailure } from '../experience/action-errors'

/** The browser default applies only to generic creation in All profiles. */
export function defaultNewSessionTarget(): { profile: string; route: AgentProfileRoute } | null {
  if (!$showAllProfiles.get()) return null
  const route = browserDefaultProfile.getSnapshot()
  if (!route?.connectionId || !$profiles.get().some(profile => profile.name === route.profile)) return null
  return { profile: route.profile, route: { connectionId: route.connectionId, profile: route.profile } }
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
