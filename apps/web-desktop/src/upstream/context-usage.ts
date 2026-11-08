import { useCallback } from 'react'
import { useStore } from '@nanostores/react'
import { useContextBreakdown } from '@/app/shell/hooks/use-context-breakdown'
import { useStoreSelector } from '@/lib/use-session-slice'
import { getApiRequestConnection } from '@/api/client'
import { requestGatewayForAgent } from '@/store/gateway'
import { $activeGatewayProfile } from '@/store/profile'
import { $activeSessionId, $sessionResumeRequest } from '@/store/session'
import { $sessionStates } from '@/store/session-states'
import type { BrowserConversationModel } from '../experience/contracts/conversation'
import type { BrowserContextUsage } from '../experience/contracts/context-usage'

/** Read the selected chat's own runtime; merged global usage can belong to the previous chat. */
export function useBrowserContextUsage(conversation: BrowserConversationModel): BrowserContextUsage {
  const activeId = useStore($activeSessionId)
  const resume = useStore($sessionResumeRequest)
  const activeProfile = useStore($activeGatewayProfile)
  const storedId = conversation.sessionId
  const boundId = useStoreSelector($sessionStates, states => activeId ? states[activeId]?.storedSessionId : null)
  const runtimeId = storedId && boundId === storedId ? activeId : null
  const usage = useStoreSelector($sessionStates, states => runtimeId ? states[runtimeId]?.usage : null)
  const busy = useStoreSelector($sessionStates, states => Boolean(runtimeId && states[runtimeId]?.busy))
  const owner = resume?.sessionId === storedId ? resume.ownerRoute : undefined
  const connectionId = owner?.connectionId || conversation.connectionId || getApiRequestConnection()
  const profile = owner?.profile || conversation.profile || activeProfile
  const targetProfile = owner?.targetProfile || profile
  const requestGateway = useCallback(<T,>(method: string, params?: Record<string, unknown>) =>
    requestGatewayForAgent<T>(connectionId, profile, method, { ...params, profile: targetProfile }),
  [connectionId, profile, targetProfile])
  const { breakdown, loading } = useContextBreakdown({
    busy, enabled: conversation.status === 'ready' && Boolean(storedId),
    requestGateway, sessionId: runtimeId || storedId
  })
  const reading = breakdown?.context_max ? breakdown : usage
  const capacity = reading?.context_max
  const used = reading?.context_used
  const available = typeof capacity === 'number' && Number.isFinite(capacity) && capacity > 0 &&
    typeof used === 'number' && Number.isFinite(used) && used >= 0
  return {
    used: available ? used : null,
    capacity: available ? capacity : null,
    estimated: Boolean(reading?.context_estimated), loading
  }
}
