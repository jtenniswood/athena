import { readFile } from 'node:fs/promises'
import { createSign } from 'node:crypto'

/** Server credentials stay in a mounted secret file; notification bodies contain no chat text. */
export function createFirebaseSender({ credentialsPath = process.env.ATHENA_FIREBASE_CREDENTIALS, fetch: request = globalThis.fetch, now = Date.now } = {}) {
  let token, expires = 0, credentials
  const accessToken = async () => {
    if (token && expires > now() + 60000) return token
    credentials ??= JSON.parse(await readFile(credentialsPath, 'utf8'))
    if (!credentials.project_id || !credentials.client_email || !credentials.private_key) throw new Error('Invalid Firebase credentials')
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
    const issued = Math.floor(now() / 1000)
    const unsigned = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({
      iss: credentials.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token', iat: issued, exp: issued + 3600
    })
    const signature = createSign('RSA-SHA256').update(unsigned).sign(credentials.private_key, 'base64url')
    const response = await request('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + signature }),
      signal: AbortSignal.timeout(10000)
    })
    if (!response.ok) throw new Error('Firebase authentication failed')
    const result = await response.json()
    if (typeof result.access_token !== 'string') throw new Error('Firebase returned no access token')
    token = result.access_token; expires = now() + Math.min(Number(result.expires_in) || 3600, 3600) * 1000
    return token
  }
  const sendMessage = async (message, validateOnly = false) => {
      const bearer = await accessToken()
      const response = await request(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credentials.project_id)}/messages:send`, {
        method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, ...(validateOnly ? { validate_only: true } : {}) }),
        signal: AbortSignal.timeout(10000)
      })
      if (response.status === 401) expires = 0
      if (!response.ok) throw new Error(`Firebase send failed (${response.status})`)
  }
  return {
    enabled: Boolean(credentialsPath),
    send(deviceToken, data, priority = 'HIGH') {
      return sendMessage({ token: deviceToken, data, android: { priority, ttl: '3600s' } })
    },
    validate() {
      return sendMessage({ topic: 'athena-setup-validation', data: { kind: 'setup' } }, true)
    }
  }
}
