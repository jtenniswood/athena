import assert from 'node:assert/strict'
import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt } from 'node:crypto'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { createAndroidAuthHandler } from './android-auth.mjs'

const origin = 'https://athena.example.com'
const route = '/api/athena/android/auth/access'
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const key = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
const state = 'x'.repeat(43)
async function fixture(t) {
  const handler = createAndroidAuthHandler({ target: 'http://gateway.test', fetch: () => { throw Error('Must not require Hermes authentication') }, now: () => 1234 })
  const server = createServer((req, res) => { void handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}${route}`
  const headers = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'athena.example.com' }
  return { get: params => fetch(url + '?' + new URLSearchParams(params), { headers }),
    post: (params, extra = {}) => fetch(url, { method: 'POST', headers: { ...headers, origin, 'content-type': 'application/x-www-form-urlencoded', ...extra }, body: new URLSearchParams(params) }) }
}

test('Access bootstrap requires explicit approval and encrypts only the Access cookie for the requesting app', async t => {
  const { get, post } = await fixture(t)
  const preview = await get({ key, state })
  const html = await preview.text()
  assert.equal(preview.status, 200)
  assert.match(html, /Approve Android connection/)
  assert.doesNotMatch(html, /shows code|matching code|pairing/i)
  assert.match(html, /xxxxxx/)
  assert.ok(!html.includes('athena-android://'), 'opening the page does not release a session')
  assert.equal(preview.headers.get('referrer-policy'), 'same-origin')
  assert.equal(preview.headers.get('cache-control'), 'no-store')
  const token = 'eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjQwMDAwMDAwMDB9.signature'
  const approved = await post({ key, state }, { cookie: `CF_Authorization=${token}; pocket_id_session=private; hermes_session_at=private` })
  const result = await approved.text()
  assert.equal(approved.status, 200)
  assert.ok(!result.includes(token) && !result.includes('private'))
  const callback = result.match(/athena-android:\/\/access#([A-Za-z0-9_-]+)/)[1]
  const envelope = Buffer.from(callback, 'base64url')
  const aesKey = privateDecrypt({ key: pair.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, envelope.subarray(0, 256))
  const aes = createDecipheriv('aes-256-gcm', aesKey, envelope.subarray(256, 268))
  aes.setAuthTag(envelope.subarray(-16))
  const body = JSON.parse(Buffer.concat([aes.update(envelope.subarray(268, -16)), aes.final()]))
  assert.deepEqual(body, { origin, state, created: 1234, token })
  const wrong = generateKeyPairSync('rsa', { modulusLength: 2048 })
  assert.throws(() => privateDecrypt({ key: wrong.privateKey, oaepHash: 'sha256' }, envelope.subarray(0, 256)))
})

test('Access bootstrap rejects missing cookies, unsafe input and cross-origin approvals', async t => {
  const { get, post } = await fixture(t)
  assert.equal((await post({ key, state })).status, 409)
  assert.equal((await post({ key, state }, { origin: 'null' })).status, 403)
  assert.equal((await post({ key, state }, { origin: 'https://attacker.test', cookie: 'CF_Authorization=valid' })).status, 403)
  assert.equal((await get({ key, state: '<script>' })).status, 400)
  assert.equal((await get({ key: 'a'.repeat(400), state })).status, 400)
  assert.equal((await post({ key, state }, { 'x-forwarded-proto': 'http', origin: 'http://athena.example.com' })).status, 400)
})
