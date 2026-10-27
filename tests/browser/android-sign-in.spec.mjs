import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createAndroidAuthHandler } from '../../scripts/android-auth.mjs'

test.use({ ignoreHTTPSErrors: true })
let server, origin, directory

// Exercise the pinned gateway's actual redirect validator without importing its server runtime.
const hermesSafetySource = path.resolve(realpathSync(new URL('../../apps/desktop', import.meta.url)), '../../hermes_cli/dashboard_auth/request_utils.py')
function hermesPostLoginTarget(next) {
  return execFileSync('python3', ['-c', `
import ast, pathlib, sys
source = ast.parse(pathlib.Path(sys.argv[1]).read_text())
selected = [node for node in source.body if
    isinstance(node, ast.FunctionDef) and node.name == 'is_safe_next_path' or
    isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == '_NEXT_DENY_PREFIXES' for target in node.targets)]
namespace = {}
exec(compile(ast.Module(body=selected, type_ignores=[]), sys.argv[1], 'exec'), namespace)
print(sys.argv[2] if namespace['is_safe_next_path'](sys.argv[2]) else '/')
`, hermesSafetySource, next], { encoding: 'utf8' }).trim()
}

test.beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'athena-browser-auth-'))
  const key = path.join(directory, 'key.pem'), cert = path.join(directory, 'cert.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' })
  const handler = createAndroidAuthHandler({ target: 'http://gateway.test', fetch: async (_url, options) =>
    options.headers.cookie?.includes('hermes_session_at=valid') ? Response.json({ user_id: 'test' }) : Response.json({}, { status: 401 }) })
  server = createServer({ key: await readFile(key), cert: await readFile(cert) }, (req, res) => {
    const url = new URL(req.url, 'https://' + req.headers.host)
    if (url.pathname === '/auth/login') {
      const target = hermesPostLoginTarget(url.searchParams.get('next') || '')
      res.writeHead(302, { Location: target, 'Set-Cookie': '__Host-hermes_session_at=valid; Path=/; Secure; HttpOnly; SameSite=Lax' })
      res.end(); return
    }
    void handler(req, res).then(handled => {
      if (!handled) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<h1>Signed into the browser only</h1>') }
    })
  })
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
  const start = await context.request.post(origin + root + 'start', { headers: { Origin: origin }, data: { challenge, loginPath: '/auth/login?provider=self-hosted' } })
  expect(start.status()).toBe(200)
  const { id, loginPath } = await start.json()
  await page.goto(origin + loginPath)
  await expect(page.getByRole('button', { name: 'Sign in to Athena Android' })).toBeVisible({ timeout: 3000 })
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
