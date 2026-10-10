import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createPreviewGateway } from '../../scripts/preview/gateway.mjs'
import { getBrowserTarget } from './test-target.mjs'

const { image, url } = getBrowserTarget()
test.skip(!image && !url && !process.env.CI, 'Set HERMES_TEST_IMAGE or HERMES_BROWSER_PREVIEW_URL')
let gateway, container, origin

test.beforeAll(async () => {
  if (url) { origin = url; return }
  if (!image) throw new Error('HERMES_TEST_IMAGE is required in CI')
  gateway = createPreviewGateway()
  await new Promise(resolve => gateway.server.listen(0, '0.0.0.0', resolve))
  container = execFileSync('docker', ['run', '-d', '--rm', '--add-host', 'host.docker.internal:host-gateway', '-p', '127.0.0.1::80', '-e', `HERMES_GATEWAY_URL=http://host.docker.internal:${gateway.server.address().port}`, image], { encoding: 'utf8' }).trim()
  const port = execFileSync('docker', ['port', container, '80/tcp'], { encoding: 'utf8' }).trim().split(':').at(-1)
  origin = `http://127.0.0.1:${port}`
  await expect.poll(async () => { try { return (await fetch(origin)).status } catch { return 0 } }).toBe(200)
})
test.afterAll(async () => {
  if (container) execFileSync('docker', ['stop', container], { stdio: 'ignore' })
  await gateway?.close()
})

const oidc = { name: 'self-hosted', display_name: 'Self-Hosted OIDC', supports_password: false }
const editor = page => page.locator('[contenteditable="true"]:visible').first()

async function hermesAuth(context, { providers = [oidc], signedIn = false, authMode } = {}) {
  if (authMode) await context.route(/\/runtime-config\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch()
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__HERMES_RUNTIME_CONFIG__.auth = ${JSON.stringify({ mode: authMode })};` })
  })
  if (signedIn) await context.addCookies([{ name: 'athena_test_session', value: 'authenticated', url: origin, httpOnly: true }])
  await context.route('**/api/status', route => route.fulfill({ json: { auth_required: true, auth_providers: providers.map(item => item.name) } }))
  await context.route('**/api/auth/providers', route => route.fulfill({ json: { providers } }))
  await context.route('**/api/auth/me', async route => {
    // WebKit omits Cookie from intercepted request headers. Inspect the
    // per-origin browser jar when simulating Hermes's session verification.
    const authenticated = (await context.cookies(route.request().url()))
      .some(cookie => cookie.name === 'athena_test_session' && cookie.value === 'authenticated')
    return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? { provider: 'self-hosted', user_id: 'test-user' } : { detail: 'sign_in_required' } })
  })
  // Model Hermes -> external IDP -> Hermes callback. Only Hermes sets the session.
  let returnTo = '/'
  await context.route('**/auth/login?*', route => {
    const request = new URL(route.request().url())
    returnTo = request.searchParams.get('next') || '/'
    // Fresh navigations let Playwright intercept each hop (it does not re-route
    // requests following a mocked HTTP redirect to a different host).
    return route.fulfill({ contentType: 'text/html', body: '<script>location.replace("https://identity.example.test/authorize")</script>' })
  })
  await context.route('https://identity.example.test/authorize', route => route.fulfill({
    contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(`${origin}/auth/callback?code=synthetic&state=synthetic`)})</script>`
  }))
  await context.route('**/auth/callback?*', route => route.fulfill({
    contentType: 'text/html',
    headers: { 'set-cookie': 'athena_test_session=authenticated; Path=/; HttpOnly; SameSite=Lax' },
    body: `<script>location.replace(${JSON.stringify(returnTo)})</script>`
  }))
  await context.route('**/auth/logout', route => route.fulfill({
    // WebKit cannot fulfill mocked redirects; model the completed login response.
    status: context.browser().browserType().name() === 'webkit' ? 200 : 302,
    contentType: 'text/html', body: '<p>Signed out</p>',
    headers: { location: '/login', 'set-cookie': 'athena_test_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' }
  }))
}

async function selectSignOut(page, compact = false) {
  await page.getByRole('button', { name: 'Open settings menu', exact: true }).click()
  const menu = page.getByRole(compact ? 'dialog' : 'menu', { name: 'Settings and workspace', exact: true })
  await menu.getByRole(compact ? 'button' : 'menuitem', { name: 'Sign out', exact: true }).click()
}

async function expectSignOutError(page, message) {
  // The fixture can also report backend skew; expand the notification stack.
  await expect.poll(async () => {
    const more = page.getByRole('button', { name: /^Show \d+ more notifications?$/ })
    if (await more.isVisible()) await more.click()
    return page.getByText(message, { exact: true }).isVisible()
  }).toBe(true)
}

for (const width of [390, 1440]) {
  test.extend({ hasTouch: width === 390 })(`settings sign-out returns to sign-in and preserves text drafts at ${width}px`, async ({ page, context }) => {
    await hermesAuth(context, { signedIn: true })
    await page.setViewportSize({ width, height: 960 })
    await page.goto(`${origin}/#/preview-week`)
    await expect(editor(page)).toBeVisible({ timeout: 30000 })
    await editor(page).fill('Keep this draft after signing out')
    const logout = page.waitForRequest(request => request.url().endsWith('/auth/logout'))
    await selectSignOut(page, width === 390)
    expect((await logout).method()).toBe('POST')
    await expect(page.getByRole('heading', { name: 'Welcome to Athena' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in with Self-Hosted OIDC' })).toBeEnabled()
    await expect(editor(page)).toHaveCount(0)
    await expect(page).toHaveURL(/#\/preview-week$/)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hermes:composer-drafts:v3'))['preview-week'])).toBe('Keep this draft after signing out')
    await context.addCookies([{ name: 'athena_test_session', value: 'authenticated', url: origin, httpOnly: true }])
    await page.reload()
    await expect(editor(page)).toHaveText('Keep this draft after signing out', { timeout: 30000 })
  })
}

test('settings sign-out clears imported session tokens', async ({ page, context }) => {
  await hermesAuth(context, { signedIn: true })
  await page.goto(`${origin}/?token=synthetic-session-token#/preview-week`)
  await expect(editor(page)).toBeVisible({ timeout: 30000 })
  await selectSignOut(page)
  await expect(page.getByRole('button', { name: 'Sign in with Self-Hosted OIDC' })).toBeEnabled()
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('hermes-web.connection.v2.')).map(key => JSON.parse(localStorage.getItem(key))).every(state => state.authMode === 'oauth' && state.token === ''))).toBe(true)
})

test('failed sign-out keeps chat and token credentials available for retry', async ({ page, context }) => {
  await hermesAuth(context, { signedIn: true })
  await context.route('**/auth/logout', route => route.fulfill({ status: 503, json: { detail: 'Unavailable' } }))
  await page.goto(`${origin}/?token=synthetic-session-token#/preview-week`)
  await expect(editor(page)).toBeVisible({ timeout: 30000 })
  await editor(page).fill('Keep this draft on failure')
  await selectSignOut(page)
  await expectSignOutError(page, 'Sign-out failed (503). Try again.')
  await expect(editor(page)).toHaveText('Keep this draft on failure')
  expect(await page.evaluate(() => window.hermesDesktop.getConnectionConfig())).toMatchObject({ remoteAuthMode: 'token', remoteTokenSet: true })
  await page.getByRole('button', { name: 'Open settings menu', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeEnabled()
})

test('sign-out saves text edited while logout is pending', async ({ page, context }) => {
  await hermesAuth(context, { signedIn: true })
  let releaseLogout
  const pendingLogout = new Promise(resolve => { releaseLogout = resolve })
  await context.route('**/auth/logout', async route => {
    await pendingLogout
    await route.fallback()
  })
  await page.goto(`${origin}/#/preview-week`)
  await expect(editor(page)).toBeVisible({ timeout: 30000 })
  await editor(page).fill('Before sign-out')
  const requested = page.waitForRequest(request => request.url().endsWith('/auth/logout'))
  await selectSignOut(page)
  await requested
  await editor(page).fill('Edited while signing out')
  releaseLogout()
  await expect(page.getByRole('heading', { name: 'Welcome to Athena' })).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hermes:composer-drafts:v3'))['preview-week'])).toBe('Edited while signing out')
})

test('sign-out leaves unsent attachments in chat without ending the session', async ({ page, context }) => {
  await hermesAuth(context, { signedIn: true })
  let logouts = 0
  page.on('request', request => { if (request.url().endsWith('/auth/logout')) logouts++ })
  await page.goto(`${origin}/#/preview-week`)
  await expect(editor(page)).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: 'Files…', exact: true }).click()
  await (await picker).setFiles({ name: 'unsent.txt', mimeType: 'text/plain', buffer: Buffer.from('Keep this attachment') })
  await expect(page.getByRole('button', { name: 'Remove unsent.txt', exact: true })).toBeVisible()
  await selectSignOut(page)
  await expectSignOutError(page, 'Send or remove unsent attachments before reloading.')
  await expect(page.getByRole('button', { name: 'Remove unsent.txt', exact: true })).toBeVisible()
  expect(logouts).toBe(0)
})

test('signed-out users see sign-in before any chat connection; server labels are plain text', async ({ page, context }) => {
  await hermesAuth(context, { providers: [{ ...oidc, display_name: '<img src=x onerror=alert(1)>' }] })
  let sockets = 0
  page.on('websocket', () => sockets++)
  await page.goto(origin)
  await expect(page.getByRole('heading', { name: 'Welcome to Athena' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in with <img src=x onerror=alert(1)>' })).toBeEnabled()
  expect(await page.evaluate(() => Boolean(window.hermesDesktop))).toBe(false)
  expect(sockets).toBe(0)
  await expect(page.locator('.athena-sign-in button img')).toHaveCount(0)
})

test('OIDC popup success connects automatically and keeps the selected conversation', async ({ page, context }) => {
  await hermesAuth(context)
  await page.goto(`${origin}/#/preview-week`)
  const popupReady = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Sign in with Self-Hosted OIDC' }).click()
  const popup = await popupReady
  await expect.poll(() => popup.isClosed()).toBe(true)
  await expect(editor(page)).toBeVisible({ timeout: 30000 })
  await expect(page.locator('[data-browser-conversation-id]')).toHaveAttribute('data-browser-conversation-id', 'preview-week')
  expect((await context.cookies()).find(cookie => cookie.name === 'athena_test_session')?.httpOnly).toBe(true)
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('hermes-web.connection.v2.')).map(key => JSON.parse(localStorage.getItem(key)).token))).toEqual([''])
})

for (const mode of ['mobile', 'installed PWA']) {
  test(`${mode} sign-in returns in the same window to the original conversation and preserves saved drafts`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: mode === 'mobile', hasTouch: mode === 'mobile' })
    try {
      await hermesAuth(context)
      const page = await context.newPage()
      if (mode === 'installed PWA') await page.addInitScript(() => {
        const matchMedia = window.matchMedia.bind(window)
        window.matchMedia = query => query === '(display-mode: standalone)' ? { ...matchMedia(query), matches: true } : matchMedia(query)
      })
      await page.addInitScript(() => {
        if (!localStorage.getItem('hermes:composer-drafts:v3')) localStorage.setItem('hermes:composer-drafts:v3', JSON.stringify({ 'preview-week': 'Keep this unsent text' }))
      })
      await page.goto(`${origin}/?source=bookmark#/preview-week`)
      await expect(page.getByRole('button', { name: 'Sign in with Self-Hosted OIDC' })).toBeEnabled()
      await page.screenshot({ path: testInfo.outputPath('sign-in-phone.png') })
      await expect(page.getByRole('button', { name: 'Continue in this window' })).toBeHidden()
      await page.getByRole('button', { name: 'Sign in with Self-Hosted OIDC' }).click()
      await expect(editor(page)).toBeVisible({ timeout: 30000 })
      expect(new URL(page.url()).searchParams.get('source')).toBe('bookmark')
      await expect(page.locator('[data-browser-conversation-id]')).toHaveAttribute('data-browser-conversation-id', 'preview-week')
      await expect(editor(page)).toHaveText('Keep this unsent text')
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hermes:composer-drafts:v3'))['preview-week'])).toBe('Keep this unsent text')
      expect(context.pages()).toHaveLength(1)
    } finally { await context.close() }
  })
}

test('session-token controls stay reachable above the mobile keyboard', async ({ page, context }) => {
  await hermesAuth(context)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    const viewport = window.visualViewport
    const state = { height: 844, offsetTop: 0 }
    for (const key of Object.keys(state)) Object.defineProperty(viewport, key, { get: () => state[key] })
    window.signInKeyboard = () => {
      Object.assign(state, { height: 300, offsetTop: 48 })
      viewport.dispatchEvent(new Event('resize'))
    }
  })
  await page.goto(origin)
  await page.getByText('Use a session token', { exact: true }).click()
  await page.getByLabel('Session token', { exact: true }).fill('synthetic-session-token')
  await page.evaluate(() => window.signInKeyboard())
  const connect = page.getByRole('button', { name: 'Connect with token' })
  await connect.scrollIntoViewIfNeeded()
  await expect.poll(async () => {
    const box = await connect.boundingBox()
    return box.y >= 48 && box.y + box.height <= 348
  }).toBe(true)
  await connect.click()
  await expect(editor(page)).toBeVisible({ timeout: 30000 })
})

test('a blocked popup offers same-window sign-in and then connects', async ({ page, context }) => {
  await hermesAuth(context)
  await page.addInitScript(() => { window.open = () => null })
  await page.goto(origin)
  await page.getByRole('button', { name: 'Sign in with Self-Hosted OIDC' }).click()
  await expect(page.getByRole('status')).toContainText('window was blocked')
  await page.getByRole('button', { name: 'Continue in this window' }).click()
  await expect(editor(page)).toBeVisible({ timeout: 30000 })
})

test('cancelled sign-in stays on the welcome screen without connecting chat', async ({ page, context }) => {
  await hermesAuth(context)
  await context.route('**/auth/login?*', route => route.fulfill({ contentType: 'text/html', body: '<h1>Identity provider</h1>' }))
  await page.goto(origin)
  const popupReady = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Sign in with Self-Hosted OIDC' }).click()
  const popup = await popupReady
  await popup.close()
  await expect(page.getByRole('status')).toContainText('Sign-in did not complete')
  await expect(page.getByRole('button', { name: 'Sign in with Self-Hosted OIDC' })).toBeEnabled()
  expect(await page.evaluate(() => Boolean(window.hermesDesktop))).toBe(false)
})

test('an unavailable server offers retry without pretending the user is signed out', async ({ page, context }) => {
  await hermesAuth(context)
  let unavailable = true
  await context.route('**/api/status', route => route.fulfill({ status: unavailable ? 503 : 200, json: { auth_required: true } }))
  await page.goto(origin)
  await expect(page.getByRole('status')).toContainText('Could not reach your Hermes server')
  await expect(page.getByRole('button', { name: 'Sign in with Self-Hosted OIDC' })).toBeHidden()
  unavailable = false
  await page.getByRole('button', { name: 'Retry connection' }).click()
  await expect(page.getByRole('button', { name: 'Sign in with Self-Hosted OIDC' })).toBeEnabled()
})

test('existing cookie sessions bypass sign-in', async ({ page, context }) => {
  await hermesAuth(context, { signedIn: true })
  await page.goto(`${origin}/#/preview-week`)
  await expect(editor(page)).toBeVisible({ timeout: 30000 })
  await expect(page.getByRole('heading', { name: 'Welcome to Athena' })).toHaveCount(0)
})

test('a proxy login page cannot be mistaken for a verified Hermes session', async ({ page, context }) => {
  await hermesAuth(context)
  await context.route('**/api/auth/me', route => route.fulfill({ contentType: 'text/html', body: '<h1>Proxy sign-in</h1>' }))
  await page.goto(origin)
  await expect(page.getByRole('status')).toContainText('Could not reach your Hermes server')
  expect(await page.evaluate(() => Boolean(window.hermesDesktop))).toBe(false)
})

test('sign-in completed in another tab connects when Athena regains focus', async ({ page, context }) => {
  await hermesAuth(context)
  await page.goto(origin)
  await expect(page.getByRole('button', { name: 'Sign in with Self-Hosted OIDC' })).toBeEnabled()
  await context.addCookies([{ name: 'athena_test_session', value: 'authenticated', url: origin, httpOnly: true }])
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(editor(page)).toBeVisible({ timeout: 30000 })
})

test('multiple providers use the Hermes provider chooser', async ({ page, context }) => {
  await hermesAuth(context, { providers: [oidc, { name: 'basic', display_name: 'Password', supports_password: true }] })
  await context.route('**/login?*', route => route.fulfill({ contentType: 'text/html', body: '<h1>Choose your provider</h1>' }))
  await page.goto(origin)
  const popupReady = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  const popup = await popupReady
  await expect(popup.getByRole('heading', { name: 'Choose your provider' })).toBeVisible()
  await popup.close()
})

test('session-token import retains the existing connection path', async ({ page, context }) => {
  await hermesAuth(context)
  await page.goto(`${origin}/?token=synthetic-session-token#/preview-week`)
  await expect(editor(page)).toBeVisible({ timeout: 30000 })
  expect(new URL(page.url()).searchParams.has('token')).toBe(false)
  expect(await page.evaluate(async () => (await window.hermesDesktop.getConnectionConfig()).remoteAuthMode)).toBe('token')
})

test('Docker Hermes mode uses the Hermes login page even when OIDC is registered', async ({ page, context }) => {
  await hermesAuth(context, { authMode: 'hermes' })
  await context.route('**/login?*', route => route.fulfill({ contentType: 'text/html', body: '<h1>Hermes account sign-in</h1>' }))
  await page.goto(`${origin}/#/preview-week`)
  const popupReady = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Sign in with Hermes Agent', exact: true }).click()
  const popup = await popupReady
  await expect(popup.getByRole('heading', { name: 'Hermes account sign-in' })).toBeVisible()
  expect(new URL(popup.url()).pathname).toBe('/login')
  expect(new URL(popup.url()).searchParams.get('next')).toBe('/#/preview-week')
  await popup.close()
})

test('Docker OIDC mode selects the self-hosted provider from several providers', async ({ page, context }) => {
  await hermesAuth(context, { authMode: 'oidc', providers: [{ name: 'basic', display_name: 'Password', supports_password: true }, oidc] })
  let selectedProvider
  await context.route('**/auth/login?*', async route => {
    selectedProvider = new URL(route.request().url()).searchParams.get('provider')
    await route.fallback()
  })
  await page.goto(`${origin}/#/preview-week`)
  await page.getByRole('button', { name: 'Sign in with OIDC', exact: true }).click()
  await expect(editor(page)).toBeVisible({ timeout: 30000 })
  expect(selectedProvider).toBe('self-hosted')
  await expect(page).toHaveURL(/#\/preview-week$/)
})

test('Docker OIDC mode reports an unavailable provider without choosing another login', async ({ page, context }) => {
  await hermesAuth(context, { authMode: 'oidc', providers: [{ name: 'basic', display_name: 'Password', supports_password: true }] })
  await page.goto(origin)
  await expect(page.getByRole('status')).toContainText('Configure the self-hosted OIDC provider on your Hermes server')
  await expect(page.getByRole('button', { name: 'Retry connection', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeHidden()
  expect(await page.evaluate(() => Boolean(window.hermesDesktop))).toBe(false)
})

for (const authMode of ['hermes', 'oidc']) {
  test(`Gateway settings uses the Docker ${authMode} sign-in flow`, async ({ page, context }) => {
    await hermesAuth(context, { authMode, signedIn: true })
    await context.route('**/auth/login?*', route => route.fulfill({ contentType: 'text/html', body: '<h1>OIDC sign-in</h1>' }))
    await context.route('**/login', route => route.fulfill({ contentType: 'text/html', body: '<h1>Hermes sign-in</h1>' }))
    await page.goto(`${origin}/#/preview-week`)
    await expect(editor(page)).toBeVisible({ timeout: 30000 })
    await context.clearCookies()
    await page.getByRole('button', { name: 'Open settings menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Server Connection', exact: true }).click()
    const form = page.getByRole('region', { name: 'Gateway connection', exact: true })
    await expect(form.getByLabel('Sign-in method')).toContainText(authMode === 'hermes' ? 'Hermes Agent sign-in' : 'OIDC sign-in')
    const popupReady = page.waitForEvent('popup')
    await form.getByRole('button', { name: 'Sign in', exact: true }).click()
    const popup = await popupReady
    await expect(popup.getByRole('heading', { name: authMode === 'hermes' ? 'Hermes sign-in' : 'OIDC sign-in', exact: true })).toBeVisible()
    if (authMode === 'oidc') expect(new URL(popup.url()).searchParams.get('provider')).toBe('self-hosted')
    await popup.close()
  })
}
