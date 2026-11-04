import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

test.use({ serviceWorkers: 'block' })
let app
test.beforeAll(async () => { app = await createBuiltApplication() })
test.afterAll(async () => { await app?.close() })
const editor = page => page.locator('[data-slot="composer-rich-input"]:visible').first()

test('connection apply blocks portaled menu actions and restores interaction after reconnect', async ({ page }) => {
  await page.goto(app.origin + '/?token=synthetic-portal-token#/preview-week')
  await expect(editor(page)).toBeVisible({ timeout: 30000 })
  await editor(page).fill('Keep this draft through the document transition')
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  const rename = page.locator('[role="menuitem"]').filter({ hasText: /^Rename/ })
  await expect(rename).toBeVisible()
  expect(await rename.evaluate(node => document.getElementById('root').contains(node))).toBe(false)
  await page.evaluate(() => {
    const mint = window.hermesDesktop.getGatewayWsUrlFor
    let first = true
    window.hermesDesktop.getGatewayWsUrlFor = async scope => {
      const url = await mint(scope)
      if (first && (!scope.profile || scope.profile === 'default')) {
        first = false
        await new Promise(resolve => { window.releasePortalDial = resolve })
      }
      return url
    }
    void window.hermesDesktop.applyConnectionConfig({ mode: 'remote' })
      .then(() => { window.portalApplyDone = true }, error => { window.portalApplyError = error.message })
  })
  try {
    await page.waitForFunction(() => Boolean(window.releasePortalDial) || Boolean(window.portalApplyError))
    expect(await page.evaluate(() => window.portalApplyError)).toBeUndefined()
    await expect(page.locator('#root')).toHaveJSProperty('inert', true)
    await expect(page.locator('body')).toHaveJSProperty('inert', true)
    await expect(rename.click({ timeout: 500 })).rejects.toThrow()
    await expect(page.locator('[role="dialog"]')).toHaveCount(0)
  } finally { await page.evaluate(() => window.releasePortalDial?.()) }
  await page.waitForFunction(() => window.portalApplyDone)
  await expect(page.locator('#root')).toHaveJSProperty('inert', false)
  await expect(page.locator('body')).toHaveJSProperty('inert', false)
  if (!await rename.isVisible()) await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await rename.click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').first().fill('Editable after reconnect')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(editor(page)).toHaveText('Keep this draft through the document transition')
  await page.reload()
  await expect(editor(page)).toHaveText('Keep this draft through the document transition')
})
