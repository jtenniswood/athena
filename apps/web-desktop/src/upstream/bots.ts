import { useStore } from '@nanostores/react'
import { $showHiddenBots } from '@/plugins/hermes-bots/hidden-bots'
export { seatableGroupBots, useGroupCapability } from '@/plugins/hermes-bots/canonical-group-capabilities'

export function useBrowserBotVisibility(): { showHidden: boolean; toggleHidden(): void } {
  const showHidden = useStore($showHiddenBots)
  return { showHidden, toggleHidden: () => $showHiddenBots.set(!$showHiddenBots.get()) }
}
