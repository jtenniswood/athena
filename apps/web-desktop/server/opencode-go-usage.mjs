import { accountIdentity, probeIdentity } from './identity.mjs'

const usagePath = '/api/athena/opencode-go/usage'
const providerUrl = 'https://opencode.ai/inference/go/v1/usage'
const cacheDuration = 60_000

export function createOpenCodeGoUsageHandler({ target, apiKey, fetch: request = globalThis.fetch, now = Date.now }) {
  let cached
  let expiresAt = 0
  let pending

  async function readUsage() {
    const response = await request(providerUrl, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error('OpenCode Go request failed')
    }

    const { usage } = await response.json()
    return Object.fromEntries(['rolling', 'weekly', 'monthly'].map(window => {
      const { percent, resetsAt } = usage[window]
      if (!Number.isFinite(percent) || typeof resetsAt !== 'string' || !Number.isFinite(Date.parse(resetsAt))) {
        throw new Error('Invalid OpenCode Go usage')
      }
      return [window, { percent: Math.max(0, Math.min(100, percent)), resetsAt }]
    }))
  }

  function getUsage() {
    if (cached && now() < expiresAt) return cached
    pending ??= readUsage().then(usage => {
      cached = usage
      expiresAt = now() + cacheDuration
      return usage
    }).finally(() => { pending = undefined })
    return pending
  }

  return async (req, res) => {
    if (new URL(req.url, 'http://local.invalid').pathname !== usagePath) return false
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(JSON.stringify(body))
      return true
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return send(405, { error: 'Method not allowed' })
    }
    if (!apiKey) return send(404, { error: 'OpenCode Go usage is disabled' })

    try {
      const headers = {}
      for (const key of ['cookie', 'authorization', 'x-hermes-session-token', 'x-forwarded-host', 'x-forwarded-proto']) {
        if (typeof req.headers[key] === 'string') headers[key] = req.headers[key]
      }
      const identity = await probeIdentity(target, headers, request)
      const cookies = identity.headers.getSetCookie()
      if (cookies.length) res.setHeader('Set-Cookie', cookies)
      if (!identity.ok) {
        await identity.body?.cancel()
        if ([401, 403].includes(identity.status)) return send(401, { error: 'Sign in to view OpenCode Go usage' })
        throw new Error('Hermes account verification failed')
      }
      accountIdentity(target, await identity.json())
      return send(200, { usage: await getUsage() })
    } catch {
      return send(503, { error: 'OpenCode Go usage is temporarily unavailable' })
    }
  }
}
