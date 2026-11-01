import { constants, createCipheriv, createPublicKey, publicEncrypt, randomBytes } from 'node:crypto'

const route = '/api/athena/android/auth/access'
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** Browser-only bootstrap: Cloudflare authenticates this route before it reaches Athena. */
export function handleAndroidAccess(req, res, origin, now = Date.now) {
  if (new URL(req.url, origin).pathname !== route) return false
  const page = (status, content) => {
    // Keep same-origin form POSTs from acquiring an opaque (null) Origin.
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff' })
    res.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Athena Access sign-in</title><h1>Connect Athena Android</h1>${content}</html>`)
  }
  return (async () => {
    try {
      if (!origin.startsWith('https://')) throw new Error('HTTPS required')
      let fields
      if (req.method === 'GET') fields = new URL(req.url, origin).searchParams
      else if (req.method === 'POST' && req.headers.origin === origin && req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) {
        let raw = ''
        for await (const chunk of req) { raw += chunk; if (raw.length > 4096) throw new Error('Request too large') }
        fields = new URLSearchParams(raw)
      } else return page(403, '<p>Same-origin approval required.</p>')
      const state = fields.get('state'), encodedKey = fields.get('key')
      if (!/^[A-Za-z0-9_-]{43}$/.test(state || '') || !/^[A-Za-z0-9_-]{350,450}$/.test(encodedKey || '')) throw new Error('Invalid request')
      const publicKey = createPublicKey({ key: Buffer.from(encodedKey, 'base64url'), type: 'spki', format: 'der' })
      if (publicKey.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyDetails.modulusLength !== 2048) throw new Error('Invalid key')
      if (req.method === 'GET') return page(200,
        `<p>Connect to <strong>${escape(origin)}</strong>.</p><p>Only continue if you started this request in your Athena Android app. This grants that app your current Cloudflare Access session. Your Pocket ID passkey stays in your browser.</p><form method="post" action="${route}"><input type="hidden" name="state" value="${escape(state)}"><input type="hidden" name="key" value="${escape(encodedKey)}"><button type="submit">Approve Android connection</button></form>`)
      // Transfer only the application Access cookie, never Pocket ID or other browser cookies.
      const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('CF_Authorization='))?.slice('CF_Authorization='.length)
      if (!token || !/^[A-Za-z0-9_.-]{20,16000}$/.test(token)) return page(409, '<p>No Cloudflare Access cookie was found. Sign in through Access and retry. This route must be protected by your Access application.</p>')
      const key = randomBytes(32), iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const data = Buffer.concat([cipher.update(JSON.stringify({ origin, state, created: now(), token })), cipher.final(), cipher.getAuthTag()])
      const wrapped = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key)
      const envelope = Buffer.concat([wrapped, iv, data]).toString('base64url')
      // Only encrypted data enters the callback URL; the app holds the private key.
      page(200, `<p>Approved. Return to the app to finish connecting.</p><a href="athena-android://access#${envelope}">Return to Athena Android</a>`)
    } catch { page(400, '<p>This connection request is invalid. Start again from the Android app.</p>') }
  })().then(() => true)
}
