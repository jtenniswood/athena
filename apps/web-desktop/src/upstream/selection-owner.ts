import { bumpBotOpenGeneration, getBotOpenGeneration } from '@/plugins/hermes-bots/shared'
import { $groupChatWorkspace } from '@/plugins/hermes-bots/group-chat'
import { reportActionFailure } from '../experience/action-errors'
import { blurBrowserComposerForMobileSelection } from '../experience/ui/overlay-focus'

/** Explicit session choices supersede Bot activation; the engine still owns the selection itself. */
export function runBrowserSessionSelection(select: () => void): void {
  blurBrowserComposerForMobileSelection()
  const generation = bumpBotOpenGeneration()
  const failed = () => {
    if (getBotOpenGeneration() === generation) reportActionFailure('Could not open conversation.')
  }
  try {
    select()
    // Retain the room and its composer; release only its selected identity.
    $groupChatWorkspace.set(null)
  } catch { failed() }
}
