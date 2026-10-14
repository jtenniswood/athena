import { expect } from '@playwright/test'
import { test, editor, openConversation } from './gateway-fixture.mjs'

test('settings save through nginx and sync to another device while preserving its draft', async ({ page, context, gatewayApp }) => {
  test.setTimeout(90000)
  await page.addInitScript(() => {
    if (!localStorage.getItem('athena-test-preferences-seeded')) {
      localStorage.setItem('hermes-web.browser.followup-behavior', 'steer')
      localStorage.setItem('hermes-web.browser.navigation-width', '410')
      localStorage.setItem('hermes-desktop-mode-v1', 'dark')
      localStorage.setItem('athena-test-preferences-seeded', 'true')
    }
  })
  await openConversation(page, gatewayApp.origin)
  const saved = async () => (await (await page.request.get(`${gatewayApp.origin}/api/athena/preferences`)).json()).values
  await expect.poll(async () => (await saved())['hermes-web.browser.followup-behavior']).toBe('steer')
  await expect.poll(async () => (await saved())['hermes-web.browser.navigation-width']).toBe('410')

  const otherDevice = await context.browser().newContext({ viewport: { width: 1440, height: 960 } })
  try {
    const other = await otherDevice.newPage()
    const errors = []
    other.on('pageerror', error => errors.push(error.message))
    await openConversation(other, gatewayApp.origin)
    expect(await other.evaluate(() => localStorage.getItem('hermes-web.browser.followup-behavior'))).toBe('steer')
    expect(await other.evaluate(() => localStorage.getItem('hermes-web.browser.navigation-width'))).toBe('410')
    expect(await other.evaluate(() => localStorage.getItem('hermes-desktop-mode-v1'))).toBe('dark')
    await editor(other).fill('Keep this device draft while applying settings')
    await page.evaluate(() => { window.location.hash = '/settings?tab=config:browser-configuration' })
    await page.getByRole('group', { name: 'Default follow-up behavior' }).getByRole('button', { name: 'Queue', exact: true }).click()
    await expect.poll(async () => (await saved())['hermes-web.browser.followup-behavior']).toBe('queue')
    await other.evaluate(() => { window.location.hash = '/settings?tab=config:browser-configuration' })
    await other.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(other.getByText('Settings changed on another device.', { exact: true })).toBeVisible()
    await other.getByRole('button', { name: 'Apply changes', exact: true }).click()
    await expect(other.getByRole('group', { name: 'Default follow-up behavior' }).getByRole('button', { name: 'Queue', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await other.goto(`${gatewayApp.origin}/#/preview-week`)
    await expect(editor(other)).toHaveText('Keep this device draft while applying settings')
    expect(errors).toEqual([])
  } finally { await otherDevice.close() }
})
