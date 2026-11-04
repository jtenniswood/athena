import { activeGatewayConnectionId } from '@/store/gateway'
import { notifyError } from '@/store/notifications'
import { $activeGatewayProfile, ensureGatewayAgent, type AgentProfileRoute } from '@/store/profile'
import { openProjectCreate } from '@/store/projects'
import { WEB_CONNECTION_ID } from '../platform/connection'

let openRequest = 0

/** Activate the destination without selecting a conversation or resetting its draft. */
export async function openBrowserProfileProjectCreate(profile: string, route?: AgentProfileRoute): Promise<void> {
  const request = ++openRequest
  const connectionId = route?.connectionId ?? WEB_CONNECTION_ID
  try {
    await ensureGatewayAgent(connectionId, profile)
    if (request !== openRequest) return
    if ($activeGatewayProfile.get() !== profile || activeGatewayConnectionId() !== connectionId) {
      throw new Error('The active profile changed before opening the project dialog. Try again from the destination profile.')
    }
    openProjectCreate()
  } catch (error) {
    if (request === openRequest) notifyError(error, `Could not create a project in ${profile}`)
  }
}
