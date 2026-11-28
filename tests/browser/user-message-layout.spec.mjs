import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

for (const touch of [true, false]) {
  test.describe(touch ? 'touch' : 'desktop', () => {
    test.use(touch ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {})

    test('long sent messages show all text and can still be edited', async ({ page }) => {
      const application = await createBuiltApplication()
      try {
        const session = 'preview-idea'
        const rows = application.gateway.messages.get(session)
        const timestamp = rows[0].timestamp
        const lastLine = 'Last item on the agenda'
        const content = `Today\nNo events scheduled\n\nTomorrow\nMorning appointment\n${'x'.repeat(150)}\n${lastLine}`
        rows.splice(0, rows.length, { id: 11, role: 'user', content, timestamp })

        await page.goto(application.origin + '/#/' + session)
        if (touch) await page.locator(`[data-web-session-id="${session}"] .browser-session-title`).first().tap()

        const turn = page.locator('[data-slot="aui_user-bubble-actions"]').filter({ hasText: lastLine })
        const card = turn.locator('.browser-user-message')
        const edit = turn.getByRole('button', { name: 'Edit message', exact: true })
        await expect(card).toBeVisible()
        const text = card.locator('[data-slot="aui_user-message-text"]')
        await expect(text).toHaveText(content)
        expect(await text.evaluate(element => {
          const cardBounds = element.closest('.browser-user-message').getBoundingClientRect()
          const range = document.createRange()
          range.selectNodeContents(element)
          return [...range.getClientRects()].every(bounds =>
            bounds.left >= cardBounds.left - 1 && bounds.right <= cardBounds.right + 1 &&
            bounds.top >= cardBounds.top - 1 && bounds.bottom <= cardBounds.bottom + 1
          )
        })).toBe(true)
        await expect(turn.getByRole('button', { name: 'Expand message', exact: true })).toHaveCount(0)

        const selectedText = await text.evaluate(element => {
          const selection = window.getSelection()
          selection.selectAllChildren(element)
          element.click()
          const selected = selection.toString()
          selection.removeAllRanges()
          return selected
        })
        expect(selectedText).toContain(lastLine)
        await expect(page.locator('[data-slot="aui_edit-composer-root"]')).toHaveCount(0)

        const controls = turn.locator('.browser-user-message-controls')
        const cardBounds = await card.boundingBox()
        expect((await controls.boundingBox()).y).toBeGreaterThanOrEqual(cardBounds.y + cardBounds.height - 1)
        if (touch) {
          expect((await edit.boundingBox()).y).toBeGreaterThanOrEqual(cardBounds.y + cardBounds.height - 1)
          await card.tap()
          await expect(page.locator('[data-slot="aui_edit-composer-root"]')).toHaveCount(0)
          await edit.tap()
        } else {
          await edit.click()
        }
        await expect(page.locator('[data-slot="aui_edit-composer-root"]')).toContainText(lastLine)
      } finally {
        await application.close()
      }
    })
  })
}
