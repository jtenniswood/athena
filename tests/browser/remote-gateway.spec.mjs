import { test, expect } from '@playwright/test'

const origin = process.env.ATHENA_GATEWAY_TEST_URL
test.skip(!origin, 'Start the UI with a separate disposable Hermes server and local model fixture.')
if (origin && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) {
  throw new Error('Remote gateway checks require a disposable localhost installation.')
}
test.setTimeout(90000)

async function signIn(page) {
  await page.goto(origin + '/login?next=%2F')
  await page.locator('input[name="username"]').fill('reviewer')
  await page.locator('input[name="password"]').fill('athena-local-review-fixture')
  await page.getByRole('button', { name: /^sign in$/i }).click()
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEditable({ timeout: 30000 })
  const telemetry = page.getByRole('button', { name: 'No thanks', exact: true })
  if (await telemetry.isVisible()) await telemetry.click()
}

test('the remote gateway preserves chat, drafts, attachments and server sign-out', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await signIn(page)
  expect(await page.evaluate(async () => {
    const connection = await window.hermesDesktop.getConnection()
    return { athena: window.__HERMES_WEB_BRIDGE__, owner: connection.connectionId, mode: connection.mode }
  })).toEqual({ athena: true, owner: 'web-single', mode: 'remote' })
  const editor = page.getByRole('textbox', { name: 'Message', exact: true })
  const prompt = `Remote gateway check ${Date.now()}`
  await editor.fill(prompt)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('p').filter({ hasText: `Local review response: ${prompt}` }).first()).toBeVisible({ timeout: 45000 })
  const draft = 'Unsent draft retained across a UI reload'
  await editor.fill(draft)
  await expect.poll(() => page.evaluate(value => Object.values(JSON.parse(localStorage.getItem('hermes:composer-drafts:v3') || '{}')).includes(value), draft)).toBe(true)
  const route = page.url()
  await page.reload()
  await expect(editor).toHaveText(draft, { timeout: 30000 })
  expect(page.url()).toBe(route)
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: 'Files…', exact: true }).click()
  await (await picker).setFiles({ name: 'gateway-review.txt', mimeType: 'text/plain', buffer: Buffer.from('Remote gateway attachment bytes') })
  await expect(page.locator('[data-slot="composer-attachments"]').getByText('gateway-review.txt', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Gateway', exact: true }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /attachments/i })).toBeVisible()
  await page.getByRole('button', { name: 'Close settings', exact: true }).click()
  await page.getByRole('button', { name: 'Remove gateway-review.txt', exact: true }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Gateway', exact: true }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  expect((await page.request.get(origin + '/api/athena/preferences')).status()).toBe(401)
  expect(errors).toEqual([])
})

test('Athena preferences sync across devices through the configured authenticated gateway', async ({ browser }) => {
  const first = await browser.newContext(), second = await browser.newContext()
  try {
    const writer = await first.newPage()
    await signIn(writer)
    const key = 'hermes-web.browser.navigation-width'
    await writer.evaluate(key => localStorage.setItem(key, '336'), key)
    await expect.poll(async () => (await (await writer.request.get(origin + '/api/athena/preferences')).json()).values[key]).toBe('336')
    const reader = await second.newPage()
    await signIn(reader)
    expect(await reader.evaluate(key => localStorage.getItem(key), key)).toBe('336')
    const result = await reader.evaluate(async () => window.hermesDesktop.api({ path: '/api/profiles' }))
    expect(result.profiles.some(profile => profile.name === 'default')).toBe(true)
  } finally { await first.close(); await second.close() }
})

test('creating a chat from a profile group retains its gateway profile owner', async ({ page }) => {
  await signIn(page)
  await page.getByRole('button', { name: 'New session in Research', exact: true }).click()
  const prompt = `Research profile check ${Date.now()}`
  const editor = page.getByRole('textbox', { name: 'Message', exact: true })
  await editor.fill(prompt)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('p').filter({ hasText: `Local review response: ${prompt}` }).first()).toBeVisible({ timeout: 45000 })
  await expect(page.locator('[data-web-session-profile="research"]').filter({ hasText: prompt }).first()).toBeVisible()
})
