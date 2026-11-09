import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

test.use({ serviceWorkers: 'block' })
let app
test.beforeAll(async () => { app = await createBuiltApplication() })
test.afterAll(async () => { await app?.close() })

for (const width of [1440, 390]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 960 }, hasTouch: width === 390 })
    test('draft profile changes preserve text and the first send fixes its owner', async ({ page }, testInfo) => {
      const creates = [], prompts = [], errors = []
      let releaseCreate
      const createGate = new Promise(resolve => { releaseCreate = resolve })
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/api/athena/preferences', route => route.abort())
      await page.addInitScript(() => {
        localStorage.setItem('hermes-web.browser.combined-profiles', 'true')
      })
      await page.routeWebSocket(/\/api\/ws/, socket => {
        const server = socket.connectToServer()
        socket.onMessage(async data => {
          const frame = JSON.parse(String(data))
          if (frame.method === 'session.create') {
            creates.push(frame.params)
            await createGate
          }
          if (frame.method === 'prompt.submit') prompts.push(frame.params)
          server.send(data)
        })
        server.onMessage(data => socket.send(data))
      })
      await page.goto(app.origin + '/#/preview-week')
      if (width === 390) await page.getByRole('button', { name: 'Plan a calmer working week', exact: true }).first().click()
      const editor = page.locator('[data-slot="composer-rich-input"]:visible').first()
      const selector = page.getByRole('button', { name: /^Chat profile:/ })
      await expect(editor).toBeVisible({ timeout: 30000 })
      await expect(selector).toHaveCount(0)
      const originalDraft = `Keep the existing chat draft at ${width}px`
      if (width === 390) {
        await editor.fill(originalDraft)
        await page.getByRole('button', { name: 'Back to chat history', exact: true }).click()
        const footer = page.locator('[data-slot="sidebar-footer"]')
        await expect(footer.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
        await expect(footer.getByRole('textbox', { name: 'Search', exact: true })).toBeVisible()
        await expect(footer.getByRole('button', { name: 'New chat', exact: true })).toHaveCount(0)
        await page.getByRole('button', { name: 'New session in Hermes', exact: true }).tap()
      } else {
        const newChatShortcut = await page.evaluate(() => /Mac/i.test(navigator.platform) ? 'Meta+Control+n' : 'Alt+n')
        await page.keyboard.press(newChatShortcut)
      }
      await expect(selector).toBeVisible()
      await expect(selector).toHaveAccessibleName('Chat profile: Hermes')
      await expect(editor).toBeEmpty()
      const text = `Keep my draft while choosing its profile at ${width}px`
      await editor.fill(text)
      for (const profile of ['Writer', 'Research']) {
        await selector.click()
        await page.getByRole('menuitemradio', { name: profile, exact: true }).click()
        await expect(selector).toHaveAccessibleName(`Chat profile: ${profile}`)
        await expect(editor).toHaveText(text)
      }
      await page.screenshot({ path: testInfo.outputPath('new-chat-profile.png') })
      // Profile selection keeps the combined sidebar scope.
      await expect(page.locator('[data-gateway-group]')).toHaveCount(3)
      await editor.press('Enter')
      await expect.poll(() => creates.length).toBe(1)
      // The menu disappears before session.create returns, closing the send race.
      await expect(selector).toHaveCount(0)
      expect(creates[0].profile).toBe('research')
      releaseCreate()
      await expect.poll(() => prompts.length).toBe(1)
      expect(prompts[0]).toMatchObject({ text, profile: 'research' })
      await expect(page.locator('[data-slot="aui_user-message-root"]').last()).toContainText(text)
      await expect(selector).toHaveCount(0)
      await page.reload()
      if (width === 390) await page.getByRole('button', { name: text.slice(0, 48), exact: true }).first().click()
      await expect(editor).toBeVisible({ timeout: 30000 })
      await expect(selector).toHaveCount(0)
      if (width === 390) {
        await page.getByRole('button', { name: 'Back to chat history', exact: true }).click()
        await page.getByRole('button', { name: 'Plan a calmer working week', exact: true }).first().click()
        await expect(editor).toHaveText(originalDraft)
      }
      expect(errors).toEqual([])
    })
  })
}
