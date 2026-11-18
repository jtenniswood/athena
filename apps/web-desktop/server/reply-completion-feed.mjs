import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { accountIdentity } from './identity.mjs'

const feedPath = '/api/sessions/reply-completions'
const maxGrantsBytes = 64 * 1024
const pageSize = 100

export async function readReplyFeedGrants(file, identityUrl) {
  if (!file) return []
  if (!isAbsolute(file)) throw new Error('Reply feed grants path must be absolute')
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK)
  let grants
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > maxGrantsBytes) throw new Error('Invalid reply feed grants file')
    const raw = Buffer.alloc(maxGrantsBytes + 1)
    const { bytesRead } = await handle.read(raw, 0, raw.length, 0)
    if (bytesRead > maxGrantsBytes) throw new Error('Reply feed grants file is too large')
    grants = JSON.parse(raw.toString('utf8', 0, bytesRead))
  } finally {
    await handle.close()
  }
  if (!Array.isArray(grants) || grants.length > 100) throw new Error('Invalid reply feed grants')
  const profiles = new Set()
  return grants.map(grant => {
    if (typeof grant?.profile !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(grant.profile) ||
        typeof grant.token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(grant.token) || profiles.has(grant.profile)) {
      throw new Error('Invalid or duplicate reply feed profile')
    }
    profiles.add(grant.profile)
    return { profile: grant.profile, token: grant.token, account: accountIdentity(identityUrl, grant.account) }
  })
}

export async function readReplyFeedPage({ target, grant, after, request, signal }) {
  const query = new URLSearchParams({ profile: grant.profile, after: String(after), limit: String(pageSize) })
  const response = await request(target + feedPath + '?' + query, {
    headers: { Authorization: 'Bearer ' + grant.token }, redirect: 'manual',
    signal: AbortSignal.any([signal, AbortSignal.timeout(6000)])
  })
  if (!response.ok) throw new Error('Hermes reply feed is unavailable')
  const { events, profile, next_cursor: next, has_more: more } = await response.json()
  if (profile !== grant.profile || !Array.isArray(events) || events.length > pageSize ||
      !Number.isSafeInteger(next) || next < after || typeof more !== 'boolean' || (more && next === after)) {
    throw new Error('Invalid Hermes reply feed page')
  }
  let last = after
  for (const event of events) {
    if (!Number.isSafeInteger(event?.sequence) || event.sequence <= last || event.sequence > next ||
        typeof event.session_id !== 'string' || !event.session_id || event.session_id.length > 256 ||
        typeof event.conversation_id !== 'string' || !event.conversation_id || event.conversation_id.length > 256 ||
        typeof event.completed_at !== 'number' || !Number.isFinite(event.completed_at) || event.completed_at <= 0) {
      throw new Error('Invalid Hermes reply feed event')
    }
    last = event.sequence
  }
  return { events, next, more }
}
