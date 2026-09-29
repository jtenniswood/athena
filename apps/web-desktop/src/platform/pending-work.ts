export type PendingWorkResult = { ready: true } | { ready: false; reason: string }

export interface PendingWorkParticipant {
  id: string
  prepare(): Promise<PendingWorkResult>
}

const participants = new Map<string, PendingWorkParticipant>()
let revision = 0

/** Register a live work owner and return a release that cannot remove its replacement. */
export function registerPendingBrowserWork(participant: PendingWorkParticipant): () => void {
  participants.set(participant.id, participant)
  revision++
  return () => {
    if (participants.get(participant.id) !== participant) return
    participants.delete(participant.id)
    revision++
  }
}

/** Prepare every current owner, repeating if ownership changes during the flush. */
export async function flushPendingBrowserWork(): Promise<PendingWorkResult> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const observedRevision = revision
    const current = [...participants.values()]
    for (const participant of current) {
      try {
        const result = await participant.prepare()
        if (!result.ready) return result
      } catch (error) {
        return {
          ready: false,
          reason: error instanceof Error ? error.message : 'Finish saving your pending work before updating.'
        }
      }
    }
    if (revision === observedRevision) return { ready: true }
  }
  return { ready: false, reason: 'New work started during the update check. Try again.' }
}
