import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { accountIdentity } from './identity.mjs'

const maxGrantsBytes = 64 * 1024

export async function readReplyRecoveryGrants(file, identityUrl) {
  if (!file) return []
  if (!isAbsolute(file)) throw new Error('Reply recovery grants path must be absolute')
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK)
  let grants
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > maxGrantsBytes) throw new Error('Invalid reply recovery grants file')
    const raw = Buffer.alloc(maxGrantsBytes + 1)
    const { bytesRead } = await handle.read(raw, 0, raw.length, 0)
    if (bytesRead > maxGrantsBytes) throw new Error('Reply recovery grants file is too large')
    grants = JSON.parse(raw.toString('utf8', 0, bytesRead))
  } finally {
    await handle.close()
  }
  if (!Array.isArray(grants) || grants.length > 100) throw new Error('Invalid reply recovery grants')
  const profiles = new Set()
  return grants.map(grant => {
    if (typeof grant?.profile !== 'string' || grant.profile === 'all' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(grant.profile) ||
        typeof grant.session_token !== 'string' || !/^[a-zA-Z0-9_-]{32,256}$/.test(grant.session_token) || profiles.has(grant.profile)) {
      throw new Error('Invalid or duplicate reply recovery profile')
    }
    profiles.add(grant.profile)
    return { profile: grant.profile, token: grant.session_token, account: accountIdentity(identityUrl, grant.account) }
  })
}
