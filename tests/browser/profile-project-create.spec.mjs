import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

test.use({ serviceWorkers: 'block' })
let app
test.beforeAll(async () => { app = await createBuiltApplication() })
test.afterAll(async () => { await app?.close() })

for (const width of [1440, 390]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 960 }, hasTouch: width === 390 })
    test('combined profiles create projects in the chosen profile without losing the draft', async ({ page }) => {
      const writes = [], errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/api/athena/preferences', route => route.abort())
      await page.addInitScript(() => {
        localStorage.setItem('hermes-web.browser.combined-profiles', 'true')
        localStorage.setItem('hermes-web.browser.hermes.desktop.sidebarAgentsGrouped.allProfiles', 'true')
      })
      await page.routeWebSocket(/\/api\/ws/, socket => {
        const server = socket.connectToServer()
        socket.onMessage(data => {
          const frame = JSON.parse(String(data))
          if (frame.method !== 'projects.create') return server.send(data)
          writes.push(frame.params)
          socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { project: null } }))
        })
        server.onMessage(data => socket.send(data))
      })
      await page.goto(app.origin + '/#/preview-week')
      if (width === 390) await page.locator('#browser-navigation').getByRole('button', { name: 'Plan a calmer working week', exact: true }).first().click()
      const editor = page.locator('[data-slot="composer-rich-input"]:visible').first()
      await expect(editor).toBeVisible({ timeout: 30000 })
      await editor.fill('Keep this draft while creating a project')
      if (width === 390) await page.getByRole('button', { name: 'Back to chat history', exact: true }).click()
      const section = page.locator('[data-browser-section-id="sessions"]')
      await expect(section.getByRole('button', { name: 'New project', exact: true })).toHaveCount(0)
      const groups = section.locator('[data-gateway-group]')
      await expect(groups).toHaveCount(3)
      for (const profile of ['default', 'research', 'writer']) {
        const group = groups.filter({ has: page.locator(`[data-browser-profile-picture="${profile}"]`) })
        await expect(group.getByRole('button', { name: /^New project in / })).toBeVisible()
        await expect(group.getByRole('button', { name: /^New session in / })).toHaveCount(0)
      }
      const research = groups.filter({ has: page.locator('[data-browser-profile-picture="research"]') })
      await research.getByRole('button', { name: 'New project in Research', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: /New project.*research/i })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await research.getByRole('button', { name: 'New project in Research', exact: true }).click()
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Add folder', exact: true }).click()
      await page.getByRole('button', { name: 'Select folder', exact: true }).click()
      await dialog.getByRole('textbox').first().fill('Research project')
      await dialog.getByRole('button', { name: 'Create', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect(groups).toHaveCount(3)
      expect(new URL(page.url()).hash).toBe('#/preview-week')
      if (width === 390) await section.getByRole('button', { name: 'Plan a calmer working week', exact: true }).click()
      await expect(editor).toHaveText('Keep this draft while creating a project')
      expect(writes).toHaveLength(1)
      expect(writes[0]).toMatchObject({ name: 'Research project', profile: 'research' })
      expect(errors).toEqual([])
    })
  })
}
