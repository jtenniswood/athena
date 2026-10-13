// Extra service-worker behavior for notifications. vite-plugin-pwa imports
// this file into its generated Workbox service worker.
self.addEventListener('notificationclick', event => {
  const notification = event.notification
  const targetUrl = notification.data?.url ?? self.location.origin + '/'
  const target = new URL(targetUrl, self.location.origin)

  notification.close()
  if (target.origin !== self.location.origin) return
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

    // Prefer the originating conversation, and never navigate another app
    // that happens to share this origin.
    clients.sort((a, b) => Number(b.url === target.href) - Number(a.url === target.href))
    for (const client of clients) {
      const clientUrl = new URL(client.url)
      if (clientUrl.origin !== target.origin || clientUrl.pathname !== target.pathname) continue
      if ('focus' in client) {
        await client.focus()

        if ('navigate' in client && client.url !== targetUrl) {
          await client.navigate(targetUrl)
        }

        return
      }
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl)
    }
  })())
})
