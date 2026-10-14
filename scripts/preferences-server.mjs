import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { MAX_PREFERENCE_BYTES, validatePreferenceValues } from './preference-schema.mjs'

export const preferencesPath = '/api/athena/preferences'

/** One process serializes patches per account; different keys merge atomically. */
export function createPreferenceStore(directory) {
  const queues = new Map()
  const read = async accountId => {
    if (!/^[a-f0-9]{64}$/.test(accountId)) throw new Error('Invalid account identity')
    try {
      const saved = JSON.parse(await readFile(path.join(directory, `${accountId}.json`), 'utf8'))
      if (saved.version !== 1 || !Number.isSafeInteger(saved.revision) || saved.revision < 0) throw new Error('Invalid saved preferences')
      validatePreferenceValues(saved.values)
      return saved
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, revision: 0, values: {} }
      throw error
    }
  }
  const patch = (accountId, changes, seed = false) => {
    const task = (queues.get(accountId) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const previous = await read(accountId)
      const values = { ...previous.values }
      for (const [key, value] of Object.entries(changes)) {
        if (!seed || !Object.hasOwn(values, key)) values[key] = value
      }
      validatePreferenceValues(values)
      if (JSON.stringify(values) === JSON.stringify(previous.values)) return previous
      const saved = { version: 1, revision: previous.revision + 1, values }
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const temporary = path.join(directory, `.${accountId}.${randomUUID()}.tmp`)
      try {
        const file = await open(temporary, 'wx', 0o600)
        try { await file.writeFile(JSON.stringify(saved)); await file.sync() } finally { await file.close() }
        await rename(temporary, path.join(directory, `${accountId}.json`))
      } finally { await unlink(temporary).catch(() => {}) }
      return saved
    })
    queues.set(accountId, task)
    void task.finally(() => { if (queues.get(accountId) === task) queues.delete(accountId) }).catch(() => {})
    return task
  }
  return { read, patch }
}

function httpError(status, message) { return Object.assign(new Error(message), { status }) }

/** Trust only the configured Hermes server to authenticate and identify users. */
export function createPreferencesHandler({ target, directory, fetch: request = globalThis.fetch }) {
  const store = createPreferenceStore(directory)
  return async (req, res) => {
    if (new URL(req.url, 'http://local.invalid').pathname !== preferencesPath) return false
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(JSON.stringify(body))
    }
    try {
      if (!['GET', 'PATCH'].includes(req.method)) throw httpError(405, 'Method not allowed')
      if (req.method === 'PATCH') {
        const scheme = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? 'https' : 'http'
        const host = req.headers['x-forwarded-host'] || req.headers.host
        if (req.headers.origin !== `${scheme}://${host}` || !req.headers['content-type']?.startsWith('application/json')) {
          throw httpError(403, 'Same-origin JSON requests are required')
        }
      }
      const headers = {}
      for (const key of ['cookie', 'authorization', 'x-hermes-session-token', 'x-forwarded-host', 'x-forwarded-proto']) {
        if (typeof req.headers[key] === 'string') headers[key] = req.headers[key]
      }
      const identityResponse = await request(`${target}/api/auth/me`, {
        headers, redirect: 'manual', signal: AbortSignal.timeout(6000)
      })
      // Auth probes can refresh a session. Return the refreshed cookies to the
      // browser instead of leaving it holding an expired or rotated token.
      const cookies = identityResponse.headers.getSetCookie()
      if (cookies.length) res.setHeader('Set-Cookie', cookies)
      if (!identityResponse.ok) throw httpError(identityResponse.status === 401 || identityResponse.status === 403 ? 401 : 503, 'Sign in to sync settings')
      const identity = await identityResponse.json()
      if (typeof identity.user_id !== 'string' || !identity.user_id || typeof identity.provider !== 'string' || !identity.provider) {
        throw httpError(503, 'The server could not verify your account')
      }
      const accountId = createHash('sha256').update(JSON.stringify([target, identity.provider, identity.org_id || '', identity.user_id])).digest('hex')
      let saved
      if (req.method === 'GET') saved = await store.read(accountId)
      else {
        let length = 0
        const chunks = []
        for await (const chunk of req) {
          length += chunk.length
          if (length > MAX_PREFERENCE_BYTES + 4096) throw httpError(413, 'Preferences are too large')
          chunks.push(chunk)
        }
        let body
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (body.version !== 1 || typeof body.seed !== 'boolean') throw new Error('Invalid request')
          validatePreferenceValues(body.changes)
        } catch { throw httpError(400, 'Invalid preferences') }
        if (body.accountId !== accountId) throw httpError(409, 'Your signed-in account changed. Reload before syncing settings.')
        saved = await store.patch(accountId, body.changes, body.seed)
      }
      send(200, { ...saved, accountId })
    } catch (error) {
      send(error.status || 503, { error: error.status ? error.message : 'Settings sync is temporarily unavailable' })
    }
    return true
  }
}
