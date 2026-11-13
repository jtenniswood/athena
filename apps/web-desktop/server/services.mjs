import { createPluginAssets } from './plugin-assets.mjs'
import { createPreferencesHandler } from './preferences-server.mjs'
import { createAndroidAuthHandler } from './android-auth.mjs'
import { createAndroidPush } from './android-push.mjs'
import { createBrowserPushSender } from './browser-push.mjs'
import { createFirebaseSender } from './firebase-messaging.mjs'
import { createGatewayCompatibility } from './gateway-compatibility.mjs'
import { createOpenCodeGoUsageHandler } from './opencode-go-usage.mjs'

/** Identical route owners and lifecycle in Vite, preview and the container. */
export function createAthenaServices({ target, identityUrl = target, directory, home, openCodeGoApiKey, fetch, now, sender = createFirebaseSender(), browserSender = createBrowserPushSender(directory) }) {
  const plugins = createPluginAssets({ home })
  const preferences = createPreferencesHandler({ target, identityUrl, directory, fetch })
  const androidAuth = createAndroidAuthHandler({ target, fetch, now })
  const gateway = createGatewayCompatibility({ target, now, fetch })
  const push = createAndroidPush({ target, identityUrl, directory, fetch, now, sender, browserSender, consumeTokenTicket: gateway.consumeTokenTicket })
  const openCodeGoUsage = createOpenCodeGoUsageHandler({ target, apiKey: openCodeGoApiKey, fetch, now })
  let closed = false
  const attached = new WeakSet()
  const close = () => {
    if (closed) return
    closed = true
    push.close()
    gateway.close()
  }
  return {
    async handle(req, res) {
      try {
        if (closed) throw new Error('Athena services have closed')
        return await gateway.handle(req, res) || await plugins(req, res) || await androidAuth(req, res) || await push.handle(req, res) || await preferences(req, res) || await openCodeGoUsage(req, res)
      } catch {
        // Never include upstream URLs, credentials or request bodies in errors.
        if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ error: 'Athena services are temporarily unavailable' }))
        return true
      }
    },
    attach(server) {
      if (closed) throw new Error('Athena services have closed')
      if (attached.has(server)) return
      attached.add(server)
      gateway.attach(server)
      push.attach(server)
      server.once('close', close)
    },
    close,
    drain: () => push.drain(),
    scanReplies: () => push.scanReplies()
  }
}
