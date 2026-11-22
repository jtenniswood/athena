/* Prepare and verify responsive tabs before activating an update. Background
 * tabs that miss both preparation requests stay open and can reload later. */
let preparingUpdate = false
const appClients = async () => (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
  .filter(client => client.url.startsWith(self.registration.scope))
const sameClients = (left, right) => left.length === right.length && right.every(client => left.some(known => known.id === client.id))
const isBackground = client => client.visibilityState === 'hidden' && !client.focused
const changedClients = 'The open Hermes tabs changed during the update check. Try again.'
const conflictingDrafts = 'Open Hermes tabs have different drafts for the same chat. Save the text you want to keep before retrying.'
const changedDrafts = 'Drafts changed during the update check. Finish editing in open Hermes tabs and try again.'
const unresponsiveClient = 'A Hermes tab did not answer the update check. Open the tab and try again, or save any work there and close it.'
function askClient(client, type, transaction) {
  return new Promise(resolve => {
    const channel = new MessageChannel()
    const finish = reply => { clearTimeout(timer); channel.port1.close(); resolve(reply) }
    const timer = setTimeout(() => finish({ ready: false, reason: unresponsiveClient, timedOut: true }), 4000)
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
      const requester = event.source.id
      let originalTexts
      let previousTimeouts = new Set()
      let deferred = new Set()
      const canProceed = current => sameClients(clients, current) && current.every(client =>
        !deferred.has(client.id) || isBackground(client))
      // Older composers can refuse verification while cross-tab storage events
      // settle. Retry that refusal once with a new transaction and every check.
      for (let attempt = 0; attempt < 3; attempt++) {
        const transaction = crypto.randomUUID()
        let committed = false
        let retrying = false
        let reason = 'The interface could not update. Try again.'
        let blockedClient
        try {
          const open = attempt === 0 ? clients : await appClients()
          if (!canProceed(open)) { reason = changedClients; return }
          const participants = open.filter(client => !deferred.has(client.id))
          const replies = await Promise.all(participants.map(client => askClient(client, 'HERMES_FLUSH_UPDATE', transaction)))
          const refusal = replies.findIndex(reply => !reply?.ready && !reply?.timedOut)
          if (refusal !== -1) {
            reason = replies[refusal]?.reason || 'Finish pending work in open Hermes tabs and try again.'
            blockedClient = participants[refusal].id
            return
          }
          const timeouts = participants.filter((_, index) => replies[index]?.timedOut)
          // Two tabs editing the same session differently must not overwrite each other.
          const texts = new Map()
          for (const reply of replies) for (const [key, text] of Object.entries(reply?.texts || {})) {
            if (texts.has(key) && texts.get(key) !== text) { reason = conflictingDrafts; return }
            texts.set(key, text)
          }
          if (timeouts.length) {
            reason = unresponsiveClient
            if (attempt === 0) {
              previousTimeouts = new Set(timeouts.map(client => client.id))
            } else if (attempt === 1 && timeouts.every(client =>
              client.id !== requester && previousTimeouts.has(client.id) && isBackground(client))) {
              // Abort this transaction before preparing only the responsive tabs.
              deferred = new Set(timeouts.map(client => client.id))
            } else return
            // Retain drafts reported by responsive tabs even if a peer timed out.
            originalTexts ??= new Map()
            for (const [key, text] of texts) {
              if (originalTexts.has(key) && originalTexts.get(key) !== text) { reason = changedDrafts; return }
              originalTexts.set(key, text)
            }
            retrying = true
            continue
          }
          // A fresh snapshot must never conceal a draft lost or changed since
          // the first attempt, including drafts in an unmounted conversation.
          if (originalTexts && [...originalTexts].some(([key, text]) => !texts.has(key) || texts.get(key) !== text)) {
            reason = changedDrafts
            return
          }
          originalTexts ??= texts
          const current = await appClients()
          if (!canProceed(current)) { reason = changedClients; return }
          const verifying = current.filter(client => !deferred.has(client.id))
          const checks = await Promise.all(verifying.map(client => askClient(client, 'HERMES_VERIFY_UPDATE', transaction)))
          const failedCheck = checks.findIndex(reply => !reply?.ready)
          if (failedCheck !== -1) {
            reason = checks[failedCheck]?.reason || changedDrafts
            if (checks[failedCheck]?.reason) blockedClient = verifying[failedCheck].id
            if (attempt !== 0) return
            retrying = true
            continue
          }
          if (!canProceed(await appClients())) { reason = changedClients; return }
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
