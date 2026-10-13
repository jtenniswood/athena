import { useStore } from '@nanostores/react'

import { $selectedStoredSessionId, $sessions } from '@/store/session'
import { $groupChatWorkspace } from '@/plugins/hermes-bots/group-chat'
import { $lastRoster } from '@/plugins/hermes-bots/data'
import { $selectedBot } from '@/plugins/hermes-bots/bot-state'
import { $workspaceMode, $workspaceOwnerKey } from '@/components/pane-shell/workspace-scope'
import { botWorkspaceOwnerKey } from '@/plugins/hermes-bots/routing'
import { resolveConversationIdentity, type BrowserConversationModel } from '../experience/contracts/conversation'

/** Read-only projection of authoritative upstream conversation state. */
export function useBrowserConversation(): BrowserConversationModel {
  const selectedSessionId = useStore($selectedStoredSessionId)
  const selectedBotKey = useStore($selectedBot)
  const groupName = useStore($groupChatWorkspace)
  const sessions = useStore($sessions)
  const bots = useStore($lastRoster)
  const workspaceMode = useStore($workspaceMode)
  const workspaceOwner = useStore($workspaceOwnerKey)
  const selectedBotOwner = workspaceMode === 'bots' && workspaceOwner
    ? bots.find(bot => botWorkspaceOwnerKey(bot) === workspaceOwner) : null

  const identity = resolveConversationIdentity({
    selectedSessionId,
    selectedBotKey,
    groupName,
    sessions,
    bots,
    selectedBotOwner
  })
  // Roster/profile metadata can change while the same session remains visible.
  // Dismiss navigation only for a different session or group, including before
  // that session's title and Bot identity have finished loading.
  const selectionKey = JSON.stringify(identity.kind === 'group'
    ? ['group', identity.id] : ['session', identity.sessionId])
  return { ...identity, selectionKey }
}
