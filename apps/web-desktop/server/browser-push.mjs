import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import webPush from 'web-push'

export function browserSubscription(value) {
  const { endpoint, keys } = value || {}
  if (typeof endpoint !== 'string' || endpoint.length > 2048 ||
      !/^[\w-]{87}$/.test(keys?.p256dh) || !/^[\w-]{22}$/.test(keys?.auth)) return
  try {
    const url = new URL(endpoint)
    // Push endpoints are supplied by clients. Only contact known public push services.
    const host = url.hostname
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
        !(host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' ||
          host === 'web.push.apple.com' || host.endsWith('.push.apple.com') ||
          host.endsWith('.notify.windows.com'))) return
    return { endpoint: url.href, keys: { p256dh: keys.p256dh, auth: keys.auth } }
  } catch { /* Invalid subscription. */ }
}

export function createBrowserPushSender(directory) {
  let keys
  function details() {
    if (keys) return keys
    const file = path.join(directory, 'web-push-keys.json')
    try { keys = JSON.parse(readFileSync(file, 'utf8')) }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      const temporary = path.join(directory, '.web-push-' + randomUUID())
      writeFileSync(temporary, JSON.stringify(webPush.generateVAPIDKeys()), { flag: 'wx', mode: 0o600 })
      try { linkSync(temporary, file) }
      catch (error) { if (error.code !== 'EEXIST') throw error }
      finally { unlinkSync(temporary) }
      keys = JSON.parse(readFileSync(file, 'utf8'))
    }
    return keys
  }
  return {
    enabled: Boolean(directory),
    publicKey: () => details().publicKey,
    send(subscription, data, ttl) {
      const url = new URL('/', data.origin)
      if (data.focusSessionId) {
        const profile = data.focusProfile ? new URLSearchParams({ profile: data.focusProfile }) : null
        if (profile) url.search = profile.toString()
        url.hash = '/' + encodeURIComponent(data.focusSessionId) + (profile ? '?' + profile : '')
      }
      const subject = url.protocol === 'https:' ? url.origin : 'mailto:postmaster@localhost'
      return webPush.sendNotification(subscription, JSON.stringify({
        title: data.title, body: data.body, url: url.href, tag: data.tag, silent: data.silent === 'true'
      }), { TTL: ttl, timeout: 8000, vapidDetails: { ...details(), subject } })
    }
  }
}
