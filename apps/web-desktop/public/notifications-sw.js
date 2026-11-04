// WindowClient.url may retain the original route. Only the live page can admit
// hash navigation, and only the emitting document can consume engine callbacks.
function requestNotificationClient(client, message) {
  return new Promise(resolve => {
    const channel = new MessageChannel()
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      channel.port1.close()
      channel.port2.close()
      resolve(result)
    }
    const timer = setTimeout(() => finish(null), 750)
    channel.port1.onmessage = event => finish(event.data)
    try { client.postMessage(message, [channel.port2]) }
    catch { finish(null) }
  })
}

async function routeNotificationClient(client, href, focusOnly = false) {
  return (await requestNotificationClient(client, { type: focusOnly ? 'ATHENA_NOTIFICATION_FOCUS' : 'ATHENA_NOTIFICATION_ROUTE', url: href }))?.ready === true
}

function notificationTarget(data, actionId) {
  try {
    const action = actionId ? data?.actions?.find(action => action.id === actionId) : undefined
    if (actionId && !action) return null
    const target = new URL(action?.url ?? data?.url ?? '/', self.location.origin)
    return target.origin === self.location.origin ? target : null
  } catch { return null }
}

async function notificationClients(target) {
  return (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(client => {
    try { const url = new URL(client.url); return url.origin === target.origin && url.pathname === target.pathname }
    catch { return false }
  })
}

async function notificationCallbackOwner(clients, data, actionId, dismiss = false) {
  if (typeof data?.source !== 'string' || typeof data?.notifyId !== 'string') return undefined
  const replies = await Promise.all(clients.map(async client => ({ client,
    response: await requestNotificationClient(client, { type: 'ATHENA_NOTIFICATION_ACTIVATE',
      source: data.source, notifyId: data.notifyId, actionId, dismiss, expiresAt: Date.now() + 750 })
  })))
  return replies.find(reply => reply.response?.owned === true)
}

async function handleNotificationClick(data, actionId = '') {
  const target = notificationTarget(data, actionId)
  if (!target) { await dismissNotificationCallbacks(data); return }
  const clients = await notificationClients(target)
  const owner = await notificationCallbackOwner(clients, data, actionId || undefined)
  const navigates = (actionId ? data.actions.find(action => action.id === actionId).navigate : data?.navigate) !== false
  if (!navigates && owner?.response.ready && 'focus' in owner.client) { await owner.client.focus(); return }
  clients.sort((a, b) => Number(b === owner?.client) - Number(a === owner?.client) || Number(b.url === target.href) - Number(a.url === target.href))
  for (const client of clients) {
    if ('focus' in client && await routeNotificationClient(client, target.href, !navigates)) {
      await client.focus()
      return
    }
  }
  if (self.clients.openWindow) await self.clients.openWindow(target.href)
}

async function dismissNotificationCallbacks(data) {
  const target = notificationTarget(data)
  if (target) await notificationCallbackOwner(await notificationClients(target), data, undefined, true)
}

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(handleNotificationClick(event.notification.data, event.action))
})
self.addEventListener('notificationclose', event => {
  event.waitUntil(dismissNotificationCallbacks(event.notification.data))
})

self.addEventListener('message', event => {
  if (event.data?.type === 'ATHENA_NOTIFICATION_CAPABILITIES') event.ports[0]?.postMessage({ notificationCallbacks: 1 })
  else if (event.data?.type === 'ATHENA_NOTIFICATION_DISMISS') {
    event.waitUntil(dismissNotificationCallbacks(event.data.data).then(() => event.ports[0]?.postMessage({ dismissed: true })))
  }
})
