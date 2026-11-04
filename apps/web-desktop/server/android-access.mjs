import { constants, createCipheriv, createPublicKey, publicEncrypt, randomBytes } from 'node:crypto'

const route = '/api/athena/android/auth/access'
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** Browser-only bootstrap: Cloudflare authenticates this route before it reaches Athena. */
export function handleAndroidAccess(req, res, origin, now = Date.now) {
  if (new URL(req.url, origin).pathname !== route) return false
  const page = (status, content, callback) => {
    const nonce = randomBytes(18).toString('base64url')
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
      'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff' })
    res.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Athena Access sign-in</title><h1>Athena Android</h1>${content}${callback ? `<script nonce="${nonce}">window.location.replace(${JSON.stringify(callback)})</script>` : ''}</html>`)
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
      } else return page(403, '<p>Same-origin request required.</p>')
      const state = fields.get('state'), encodedKey = fields.get('key')
      if (!/^[A-Za-z0-9_-]{43}$/.test(state || '') || !/^[A-Za-z0-9_-]{350,450}$/.test(encodedKey || '')) throw new Error('Invalid request')
      const publicKey = createPublicKey({ key: Buffer.from(encodedKey, 'base64url'), type: 'spki', format: 'der' })
      if (publicKey.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyDetails.modulusLength !== 2048) throw new Error('Invalid key')
      // Transfer only the application Access cookie, never Pocket ID or other browser cookies.
      const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('CF_Authorization='))?.slice('CF_Authorization='.length)
      if (!token || !/^[A-Za-z0-9_.-]{20,16000}$/.test(token)) return page(409, '<p>No Cloudflare Access cookie was found. Sign in through Access and retry. This route must be protected by your Access application.</p>')
      const key = randomBytes(32), iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const data = Buffer.concat([cipher.update(JSON.stringify({ origin, state, created: now(), token })), cipher.final(), cipher.getAuthTag()])
      const wrapped = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key)
      const envelope = Buffer.concat([wrapped, iv, data]).toString('base64url')
      // Only encrypted data enters the callback URL; the app holds the private key.
      const callback = `athena-android://access#${envelope}`
      page(200, `<p>Returning to Athena Android…</p><p>If the app does not open automatically, <a href="${escape(callback)}">Return to Athena Android</a>.</p>`, callback)
    } catch { page(400, '<p>This connection request is invalid. Start again from the Android app.</p>') }
  })().then(() => true)
}
