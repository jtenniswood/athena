// Extra service-worker behavior imported by the generated Workbox worker.
// WindowClient.url may retain the document's original route after browser
// history changes. Only the live page can admit a hash-only navigation.
function routeNotificationClient(client, href) {
  return new Promise(resolve => {
    const channel = new MessageChannel()
    let settled = false
    const finish = ready => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      channel.port1.close()
      channel.port2.close()
      resolve(ready)
    }
    // Older or unresponsive pages retain their work; open another window.
    const timer = setTimeout(() => finish(false), 750)
    channel.port1.onmessage = event => finish(event.data?.ready === true)
    try { client.postMessage({ type: 'ATHENA_NOTIFICATION_ROUTE', url: href }, [channel.port2]) }
    catch { finish(false) }
  })
}

self.addEventListener('notificationclick', event => {
  const notification = event.notification
  notification.close()
  let target
  try { target = new URL(notification.data?.url ?? '/', self.location.origin) }
  catch { return }
  if (target.origin !== self.location.origin) return
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    clients.sort((a, b) => Number(b.url === target.href) - Number(a.url === target.href))
    for (const client of clients) {
      const clientUrl = new URL(client.url)
      if (clientUrl.origin !== target.origin || clientUrl.pathname !== target.pathname) continue
      if ('focus' in client && await routeNotificationClient(client, target.href)) {
        await client.focus()
        return
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target.href)
  })())
})
