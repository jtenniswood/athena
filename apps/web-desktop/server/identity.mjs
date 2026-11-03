import { createHash } from 'node:crypto'

/** Only trusted hosting proxies may supply these forwarded headers. */
export function requestOrigin(req) {
  const scheme = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? 'https' : 'http'
  return `${scheme}://${req.headers['x-forwarded-host'] || req.headers.host}`
}

/** Preserve the deployed account namespace across preferences and push. */
export function accountIdentity(target, account) {
  if (!account || typeof account.user_id !== 'string' || !account.user_id ||
      typeof account.provider !== 'string' || !account.provider ||
      (account.org_id != null && typeof account.org_id !== 'string')) {
    throw new Error('The server could not verify your account')
  }
  return createHash('sha256').update(JSON.stringify([target, account.provider, account.org_id || '', account.user_id])).digest('hex')
}

/** Each caller deliberately chooses which credentials its endpoint accepts. */
export function probeIdentity(target, headers, request = globalThis.fetch) {
  return request(`${target}/api/auth/me`, { headers, redirect: 'manual', signal: AbortSignal.timeout(6000) })
}
