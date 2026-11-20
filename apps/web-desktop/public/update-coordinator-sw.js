/* Activate an update only when every existing app tab has flushed its drafts.
 * Old clients without this protocol time out: close them before updating. */
let preparingUpdate = false
const appClients = async () => (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
  .filter(client => client.url.startsWith(self.registration.scope))
const sameClients = (left, right) => left.length === right.length && right.every(client => left.some(known => known.id === client.id))
const changedClients = 'A Hermes tab opened or closed during the update check. Try again.'
const conflictingDrafts = 'Open Hermes tabs have different drafts for the same chat. Save the text you want to keep before retrying.'
const changedDrafts = 'Drafts changed during the update check. Finish editing in open Hermes tabs and try again.'
const unresponsiveClient = 'A Hermes tab did not answer the update check. Open the tab and try again, or save any work there and close it.'
function askClient(client, type, transaction) {
  return new Promise(resolve => {
    const channel = new MessageChannel()
    const finish = reply => { clearTimeout(timer); channel.port1.close(); resolve(reply) }
    const timer = setTimeout(() => finish({ ready: false, reason: unresponsiveClient }), 4000)
    channel.port1.onmessage = event => finish(event.data)
    try {
      client.postMessage({ type, transaction }, [channel.port2])
    } catch {
      finish({ ready: false, reason: unresponsiveClient })
    }
  })
}
self.addEventListener('message', event => {
  if (event.data?.type !== 'HERMES_PREPARE_UPDATE' || preparingUpdate) return
  // Only a same-origin application client can request this protocol.
  if (!event.source?.url?.startsWith(self.registration.scope)) return
  preparingUpdate = true
  event.waitUntil((async () => {
    try {
      const clients = await appClients()
      if (!clients.length) return
      let originalTexts
      // Older composers can refuse verification while cross-tab storage events
      // settle. Retry that refusal once with a new transaction and every check.
      for (let attempt = 0; attempt < 2; attempt++) {
        const transaction = crypto.randomUUID()
        let committed = false
        let retrying = false
        let reason = 'The interface could not update. Try again.'
        let blockedClient
        try {
          const participants = attempt === 0 ? clients : await appClients()
          if (!sameClients(clients, participants)) { reason = changedClients; return }
          const replies = await Promise.all(participants.map(client => askClient(client, 'HERMES_FLUSH_UPDATE', transaction)))
          const refusal = replies.findIndex(reply => !reply?.ready)
          if (refusal !== -1) {
            reason = replies[refusal]?.reason || 'Finish pending work in open Hermes tabs and try again.'
            blockedClient = participants[refusal].id
            if (reason === unresponsiveClient && attempt === 0) { retrying = true; continue }
            return
          }
          // Two tabs editing the same session differently must not overwrite each other.
          const texts = new Map()
          for (const reply of replies) for (const [key, text] of Object.entries(reply.texts || {})) {
            if (texts.has(key) && texts.get(key) !== text) { reason = conflictingDrafts; return }
            texts.set(key, text)
          }
          // A fresh snapshot must never conceal a draft lost or changed since
          // the first attempt, including drafts in an unmounted conversation.
          if (originalTexts && [...originalTexts].some(([key, text]) => !texts.has(key) || texts.get(key) !== text)) {
            reason = changedDrafts
            return
          }
          originalTexts ??= texts
          const current = await appClients()
          if (!sameClients(clients, current)) { reason = changedClients; return }
          const checks = await Promise.all(current.map(client => askClient(client, 'HERMES_VERIFY_UPDATE', transaction)))
          const failedCheck = checks.findIndex(reply => !reply?.ready)
          if (failedCheck !== -1) {
            reason = checks[failedCheck]?.reason || changedDrafts
            if (checks[failedCheck]?.reason) blockedClient = current[failedCheck].id
            retrying = attempt === 0
            continue
          }
          if (!sameClients(clients, await appClients())) { reason = changedClients; return }
          await self.skipWaiting()
          committed = true
          return
        } finally {
          if (!committed) for (const client of await appClients()) {
            client.postMessage({
              type: 'HERMES_ABORT_UPDATE', transaction, reason, retrying,
              anotherTab: blockedClient !== undefined && blockedClient !== client.id && reason !== unresponsiveClient
            })
          }
        }
      }
    } finally {
      preparingUpdate = false
    }
  })())
})
