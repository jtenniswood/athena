import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createAndroidAuthHandler } from '../../scripts/android-auth.mjs'

test.use({ ignoreHTTPSErrors: true })
let server, origin, directory

test.beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'athena-browser-auth-'))
  const key = path.join(directory, 'key.pem'), cert = path.join(directory, 'cert.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' })
  const handler = createAndroidAuthHandler({ target: 'http://gateway.test', fetch: async (_url, options) =>
    options.headers.cookie?.includes('hermes_session_at=valid') ? Response.json({ user_id: 'test' }) : Response.json({}, { status: 401 }) })
  server = createServer({ key: await readFile(key), cert: await readFile(cert) }, (req, res) => { void handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `https://127.0.0.1:${server.address().port}`
})
test.afterAll(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  if (directory) await rm(directory, { recursive: true, force: true })
})

const root = '/api/athena/android/auth/'

test('Access approval form preserves the browser Origin and reaches the encrypted app return link', async ({ page, context }) => {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const params = new URLSearchParams({ state: 'x'.repeat(43), key: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url') })
  await context.addCookies([{ name: 'CF_Authorization', value: 'e30.eyJleHAiOjQwMDAwMDAwMDB9.signature', url: origin, secure: true, httpOnly: true }])
  await page.goto(origin + root + 'access?' + params)
  const [response] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Approve Android connection' }).click()
  ])
  expect(response.request().headers().origin).toBe(origin)
  expect(response.status()).toBe(200)
  await expect(page.getByRole('link', { name: 'Return to Athena Android' })).toHaveAttribute('href', /^athena-android:\/\/access#[A-Za-z0-9_-]+$/)
})

test('Hermes browser session approval also preserves Origin and can be exchanged once', async ({ page, context }) => {
  const verifier = 'a'.repeat(43)
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const start = await context.request.post(origin + root + 'start', { headers: { Origin: origin }, data: { challenge } })
  expect(start.status()).toBe(200)
  const { id } = await start.json()
  await context.addCookies([{ name: '__Host-hermes_session_at', value: 'valid', url: origin, secure: true, httpOnly: true }])
  await page.goto(origin + root + 'complete?id=' + id)
  const [response] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Sign in to Athena Android' }).click()
  ])
  expect(response.request().headers().origin).toBe(origin)
  expect(response.status()).toBe(200)
  await expect(page.getByText('Sign-in approved.', { exact: false })).toBeVisible()
  const exchange = await context.request.post(origin + root + 'exchange', { headers: { Origin: origin }, data: { id, verifier } })
  expect(exchange.status()).toBe(200)
  expect(exchange.headers()['set-cookie']).toContain('__Host-hermes_session_at=valid')
  expect((await context.request.post(origin + root + 'exchange', { headers: { Origin: origin }, data: { id, verifier } })).status()).toBe(410)
})
