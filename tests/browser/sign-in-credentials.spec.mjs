import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

test.use({ serviceWorkers: 'block' })
let application
test.beforeAll(async () => { application = await createBuiltApplication() })
test.afterAll(async () => { await application?.close() })
const editor = page => page.locator('[data-slot="composer-rich-input"]:visible').first()
const status = page => page.getByRole('region', { name: 'Gateway connection', exact: true }).getByRole('status')
const signIn = page => page.getByRole('button', { name: 'Sign in', exact: true })
async function credentials(page) {
  return page.evaluate(async () => {
    const connection = await window.hermesDesktop.getConnection()
    return { mode: connection.authMode, token: connection.token }
  })
}
async function browserMode(page) {
  await page.getByRole('combobox', { name: 'Sign-in method' }).click()
  await page.getByRole('option', { name: 'Browser sign-in', exact: true }).click()
}
async function retainedDraft(page) {
  const saved = await credentials(page)
  await page.getByRole('button', { name: 'Close settings', exact: true }).click()
  await expect(editor(page)).toHaveText('Keep the sign-in attempt draft')
  await expect(page.locator('[data-browser-conversation-id]')).toHaveAttribute('data-browser-conversation-id', 'preview-week')
  await page.reload()
  await expect(editor(page)).toHaveText('Keep the sign-in attempt draft', { timeout: 30000 })
  expect(await credentials(page)).toEqual(saved)
}
async function holdFirstCredentialDial(page) {
  await page.evaluate(() => {
    const mint = window.hermesDesktop.getGatewayWsUrlFor
    let first = true
    window.credentialMints = []
    window.hermesDesktop.getGatewayWsUrlFor = async scope => {
      const result = await mint(scope)
      if (!scope.profile || scope.profile === 'default') {
        window.credentialMints.push(result)
        if (first) { first = false; await new Promise(resolve => { window.releaseCredentialDial = resolve }) }
      }
      return result
    }
  })
  return {
    entered: () => page.waitForFunction(() => Boolean(window.releaseCredentialDial)),
    release: () => page.evaluate(() => window.releaseCredentialDial?.()),
    mints: () => page.evaluate(() => window.credentialMints)
  }
}
test.beforeEach(async ({ page }) => {
  await page.goto(`${application.origin}/?token=synthetic-existing-token#/preview-week`)
  await expect(editor(page)).toBeVisible({ timeout: 30000 })
  await editor(page).fill('Keep the sign-in attempt draft')
  await page.evaluate(() => { location.hash = '/settings?tab=gateway' })
  await expect(page.getByRole('combobox', { name: 'Sign-in method' })).toBeVisible()
})

for (const popup of ['blocked', 'closed']) {
  test(`${popup} browser sign-in retains the existing credentials and draft`, async ({ page }) => {
    const original = await credentials(page)
    await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: {} }))
    await page.evaluate(popup => {
      window.open = () => popup === 'blocked' ? null : { closed: true, opener: null, close() {} }
    }, popup)
    await browserMode(page)
    await signIn(page).click()
    await expect(status(page)).toContainText('Sign-in did not complete')
    expect(await credentials(page)).toEqual(original)
    await retainedDraft(page)
  })
}

test('OAuth completion cannot borrow a retained token when the cookie session fails', async ({ page }) => {
  let failure = 401, probes = 0
  await page.route('**/api/auth/me', route => {
    probes++
    return failure === 'html'
      ? route.fulfill({ contentType: 'text/html', body: '<h1>Proxy sign-in</h1>' })
      : route.fulfill({ status: failure, json: {} })
  })
  await page.evaluate(() => { window.open = () => ({ closed: true, opener: null, close() {} }) })
  for (failure of [401, 503, 'html']) {
    const previous = probes
    const result = await page.evaluate(() => window.hermesDesktop.oauthLoginConnectionConfig(location.origin))
    expect(result.connected).toBe(false)
    expect(probes).toBeGreaterThan(previous)
  }
  expect(await credentials(page)).toEqual({ mode: 'token', token: 'synthetic-existing-token' })
})

test('browser sign-in commits only after its cookie session is confirmed', async ({ page }) => {
  let confirmSession
  await page.route('**/api/auth/me', async route => {
    if (!confirmSession) await new Promise(resolve => { confirmSession = resolve })
    await route.fulfill({ json: { user_id: 'preview-user', provider: 'preview' } })
  })
  await page.evaluate(() => { window.open = () => ({ closed: false, opener: null, close() { this.closed = true } }) })
  await browserMode(page)
  try {
    await signIn(page).click()
    await expect.poll(() => typeof confirmSession).toBe('function')
    expect(await credentials(page)).toEqual({ mode: 'token', token: 'synthetic-existing-token' })
  } finally { confirmSession?.() }
  await expect.poll(() => credentials(page)).toEqual({ mode: 'oauth', token: '' })
  await retainedDraft(page)
})

test('a rejected connection apply retains the previous credential and entered token', async ({ page }) => {
  await page.evaluate(() => {
    window.hermesDesktop.applyConnectionConfig = async () => { throw new Error('Synthetic connection preparation failed') }
  })
  const token = page.getByLabel('Session token', { exact: true })
  await token.fill('synthetic-new-token')
  await page.getByRole('button', { name: 'Save and reconnect', exact: true }).click()
  await expect(status(page)).toContainText('Synthetic connection preparation failed')
  expect(await credentials(page)).toEqual({ mode: 'token', token: 'synthetic-existing-token' })
  await expect(token).toHaveValue('synthetic-new-token')
  await retainedDraft(page)
})

test('a confirmed token apply replaces the saved credential and preserves the draft', async ({ page }) => {
  const token = page.getByLabel('Session token', { exact: true })
  await token.fill('synthetic-new-token')
  await page.getByRole('button', { name: 'Save and reconnect', exact: true }).click()
  await expect.poll(() => credentials(page)).toEqual({ mode: 'token', token: 'synthetic-new-token' })
  await expect(token).toHaveValue('')
  await retainedDraft(page)
})

test('connection apply stays exclusive until the engine reconnect completes', async ({ page }) => {
  const dials = []
  page.on('websocket', socket => dials.push(new URL(socket.url()).searchParams.get('token')))
  const held = await holdFirstCredentialDial(page)
  const token = page.getByLabel('Session token', { exact: true })
  const save = page.getByRole('button', { name: 'Save and reconnect', exact: true })
  try {
    await token.fill('synthetic-first-token')
    await save.click()
    await held.entered()
    await expect(page.locator('#root')).toHaveJSProperty('inert', true)
    await expect(save).toBeDisabled()
    const rejected = await page.evaluate(async () => {
      try { await window.hermesDesktop.applyConnectionConfig({ mode: 'remote', remoteAuthMode: 'token', remoteToken: 'synthetic-second-token' }) }
      catch (error) { return error.message }
    })
    expect(rejected).toBe('Wait for the current page transition to finish.')
    expect(await credentials(page)).toEqual({ mode: 'token', token: 'synthetic-first-token' })
    await expect(page.locator('#root')).toHaveJSProperty('inert', true)
  } finally { await held.release() }
  await expect(page.locator('#root')).toHaveJSProperty('inert', false)
  await expect(save).toBeEnabled()
  expect(dials.at(-1)).toBe('synthetic-first-token')
  await token.fill('synthetic-second-token')
  await save.click()
  await expect(save).toBeEnabled()
  expect(dials.at(-1)).toBe('synthetic-second-token')
  await retainedDraft(page)
})

for (const auth of ['token', 'oauth']) {
  test(`a credential apply follows an older manual reconnect with a fresh dial (${auth})`, async ({ page }) => {
    if (auth === 'oauth') {
      await page.evaluate(async () => {
        await window.hermesDesktop.saveConnectionConfig({ mode: 'remote', remoteAuthMode: 'oauth', remoteToken: '' })
        window.open = () => ({ closed: false, opener: null, close() { this.closed = true } })
      })
      await browserMode(page)
    }
    const held = await holdFirstCredentialDial(page)
    try {
      await page.getByRole('region', { name: 'Gateway connection', exact: true }).getByRole('button', { name: 'Reconnect gateway', exact: true }).click()
      await held.entered()
      if (auth === 'token') {
        await page.getByLabel('Session token', { exact: true }).fill('synthetic-new-token')
        await page.getByRole('button', { name: 'Save and reconnect', exact: true }).click()
      } else await signIn(page).click()
      await expect(page.locator('#root')).toHaveJSProperty('inert', true)
      expect(await credentials(page)).toEqual({ mode: auth, token: auth === 'token' ? 'synthetic-new-token' : '' })
    } finally { await held.release() }
    await expect(page.locator('#root')).toHaveJSProperty('inert', false)
    const mints = (await held.mints()).map(url => new URL(url))
    expect(mints).toHaveLength(2)
    if (auth === 'token') expect(mints.map(url => url.searchParams.get('token'))).toEqual(['synthetic-existing-token', 'synthetic-new-token'])
    else expect(mints[0].searchParams.get('ticket')).not.toBe(mints[1].searchParams.get('ticket'))
    await retainedDraft(page)
  })
}
