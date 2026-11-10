import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

let application
test.beforeAll(async () => { application = await createBuiltApplication() })
test.afterAll(async () => { await application?.close() })

test('chat actions remain available without a context usage control', async ({ page }) => {
  await page.goto(`${application.origin}/#/preview-week`)
  const toolbar = page.locator('.browser-chat-toolbar')
  const actions = toolbar.getByRole('button', { name: 'Chat actions', exact: true })
  const contextUsage = toolbar.getByRole('button', { name: /^(Estimated context|Context \d|Context usage)/ })

  await expect(actions).toBeVisible()
  await expect(contextUsage).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(actions).toBeVisible()
  await expect(contextUsage).toHaveCount(0)
})
