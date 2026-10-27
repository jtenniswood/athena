import assert from 'node:assert/strict'
import { generateKeyPairSync, verify } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createFirebaseSender } from './firebase-messaging.mjs'

test('Firebase uses a scoped signed server token, caches it, and sends a data message', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'athena-firebase-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const credentialsPath = path.join(directory, 'credentials.json')
  await writeFile(credentialsPath, JSON.stringify({ project_id: 'athena-test', client_email: 'sender@example.test',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600 })
  let authorizations = 0
  const messages = []
  const sender = createFirebaseSender({ credentialsPath, fetch: async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      authorizations++
      const jwt = options.body.get('assertion').split('.')
      assert.ok(verify('RSA-SHA256', Buffer.from(jwt.slice(0, 2).join('.')), publicKey, Buffer.from(jwt[2], 'base64url')))
      const payload = JSON.parse(Buffer.from(jwt[1], 'base64url'))
      assert.equal(payload.scope, 'https://www.googleapis.com/auth/firebase.messaging')
      assert.equal(payload.aud, url)
      return Response.json({ access_token: 'test-token', expires_in: 3600 })
    }
    assert.equal(url, 'https://fcm.googleapis.com/v1/projects/athena-test/messages:send')
    assert.equal(options.headers.Authorization, 'Bearer test-token')
    const body = JSON.parse(options.body)
    if (body.message.topic) assert.equal(body.validate_only, true, 'setup checks must never send a real notification')
    messages.push(body.message)
    return Response.json({ name: 'projects/athena-test/messages/test' })
  } })
  assert.equal(sender.enabled, true)
  await sender.send('device-token', { kind: 'turnDone' })
  await sender.send('device-token', { kind: 'turnError' }, 'NORMAL')
  await sender.validate()
  assert.equal(authorizations, 1)
  assert.equal(messages[0].android.priority, 'HIGH')
  assert.equal(messages[1].android.priority, 'NORMAL')
  assert.deepEqual(messages[0].data, { kind: 'turnDone' })
})
