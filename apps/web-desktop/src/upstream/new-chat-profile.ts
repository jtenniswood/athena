import { useStore } from '@nanostores/react'
import { computed } from 'nanostores'
import { $activeGatewayProfile, $newChatProfile, $newChatRoute, $profiles, ensureGatewayAgent, pinNewChatRoute } from '@/store/profile'
import { $activeSessionId, $busy, $freshDraftReady, $messagesEmpty, $selectedStoredSessionId, setCurrentCwdTransient, setNewChatWorkspaceTarget } from '@/store/session'
import { $groupChatWorkspace } from '@/plugins/hermes-bots/group-chat'
import { $workspaceMode } from '@/components/pane-shell/workspace-scope'
import { exitProjectScope } from '@/store/project-scope'
import { WEB_CONNECTION_ID } from '../platform/connection'
import { reportActionFailure } from '../experience/action-errors'
import type { BrowserNewChatProfile } from '../experience/contracts/profiles'

// A stored chat keeps its owner even when its transcript is empty or still loading.
const $canChooseProfile = computed(
  [$freshDraftReady, $selectedStoredSessionId, $activeSessionId, $messagesEmpty, $busy, $groupChatWorkspace, $workspaceMode],
  (fresh, selected, active, empty, busy, group, mode) => fresh && !selected && !active && empty && !busy && !group && mode !== 'bots'
)

/** Change only the unstarted draft's route; the composer and sidebar keep their state. */
export function useBrowserNewChatProfile(): BrowserNewChatProfile {
  const editable = useStore($canChooseProfile)
  const pinned = useStore($newChatProfile), route = useStore($newChatRoute)
  const active = useStore($activeGatewayProfile)
  const profile = route?.profile || pinned || active
  return {
    profile,
    editable,
    select(name) {
      // Re-read the authoritative state in case Send or navigation closed an open menu.
      if (!$canChooseProfile.get() || !$profiles.get().some(item => item.name === name)) return
      const previous = $newChatRoute.get()?.profile || $newChatProfile.get() || $activeGatewayProfile.get()
      if (name === previous) return
      exitProjectScope()
      setNewChatWorkspaceTarget(undefined)
      setCurrentCwdTransient('')
      const captured = pinNewChatRoute({ connectionId: WEB_CONNECTION_ID, profile: name })
      void ensureGatewayAgent(captured.connectionId, captured.profile, {
        beforeActivate: () => $canChooseProfile.get() && $newChatRoute.get() === captured
      }).catch(() => {
        reportActionFailure('Could not open the selected profile for this chat.')
      })
    }
  }
}
