import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

test('tapping a truncated message card reveals its full text', async ({ page }) => {
  const application = await createBuiltApplication()
  try {
    const session = 'preview-idea'
    const rows = application.gateway.messages.get(session)
    const timestamp = rows[0].timestamp
    rows.splice(0, rows.length,
      { id: 10, role: 'user', content: 'A short message.', timestamp },
      { id: 11, role: 'user', content: 'Today\nNo events scheduled\n\nTomorrow\nMorning appointment\nLast item on the agenda', timestamp: timestamp + 1 }
    )
    await page.goto(application.origin + '/#/' + session)
    await page.locator(`[data-web-session-id="${session}"] .browser-session-title`).first().tap()

    const messages = page.locator('[data-slot="aui_user-bubble-actions"]')
    const long = messages.filter({ hasText: 'Last item on the agenda' })
    const card = long.locator('[data-selectable-text="true"]')
    const toggle = long.getByRole('button', { name: 'Expand message', exact: true })
    const collapsedText = card.locator('[data-clamped="true"]')

    await expect(messages.filter({ hasText: 'A short message.' }).getByRole('button', { name: 'Expand message' })).toHaveCount(0)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(collapsedText).toBeVisible()
    const collapsedHeight = (await card.boundingBox()).height

    await card.evaluate(element => {
      const text = element.querySelector('[data-slot="aui_user-inline-text"]')
      window.getSelection().selectAllChildren(text)
      text.click()
    })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(await page.evaluate(() => window.getSelection().toString())).toContain('No events scheduled')
    await page.evaluate(() => window.getSelection().removeAllRanges())

    await card.tap()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(collapsedText).toHaveCount(0)
    await expect.poll(async () => (await card.boundingBox()).height).toBeGreaterThan(collapsedHeight)

    await card.tap()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.tap()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await toggle.tap()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await long.getByRole('button', { name: 'Edit message', exact: true }).tap()
    await expect(page.locator('[data-slot="aui_edit-composer-root"]')).toContainText('Last item on the agenda')
  } finally {
    await application.close()
  }
})
