import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

test.use({ serviceWorkers: 'block' })
let app
test.beforeAll(async () => { app = await createBuiltApplication() })
test.afterAll(async () => { await app?.close() })
const editor = page => page.locator('[data-slot="composer-rich-input"]:visible').first()
async function selectResearchBot(page) {
  await page.getByRole('tab', { name: 'Bots', exact: true }).click()
  await page.getByRole('button', { name: /Research · @/ }).click()
}

for (const width of [1440, 390]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width === 390 })
    test('scheduled tasks retain each endpoint profile from a Research chat', async ({ page }) => {
      const requests = [], errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/api/athena/preferences', route => route.abort())
      await page.route(/\/api\/cron\/jobs(?:\?|$)/, route => {
        const query = new URL(route.request().url()).searchParams
        requests.push(query.getAll('profile'))
        // Scalar backend queries retain the last value, so a duplicate ambient
        // scope must not be hidden by a fixture reading only the first value.
        const profile = Object.fromEntries(query).profile || 'all'
        return route.fulfill({ json: [{
          id: 'copied-job', name: `${profile} briefing`, prompt: `Prepare the ${profile} briefing`,
          enabled: true, state: 'scheduled', schedule_display: 'Every day at 09:00', next_run_at: '2099-01-01T09:00:00Z'
        }] })
      })
      await page.goto(app.origin + '/?profile=research#/preview-research?profile=research')
      if (width === 390) await selectResearchBot(page)
      await expect(editor(page)).toBeVisible({ timeout: 30000 })
      const chatRoute = new URL(page.url()).hash
      const conversation = page.locator('[data-browser-conversation-id]')
      const chatId = await conversation.getAttribute('data-browser-conversation-id')
      expect(chatId).toBeTruthy()
      await editor(page).fill('Keep this Research draft while reviewing scheduled tasks')
      if (width === 390) {
        await page.getByRole('button', { name: 'Back to chat history', exact: true }).click()
        await page.getByRole('tab', { name: 'Sessions', exact: true }).click()
      }
      await page.getByRole('button', { name: 'More', exact: true }).click()
      await page.getByRole('button', { name: 'Scheduled', exact: true }).click()
      const surface = page.getByRole('region', { name: 'Scheduled tasks', exact: true })
      await expect(surface.locator('details')).toHaveCount(3)
      for (const profile of ['default', 'research', 'writer']) {
        const task = surface.locator('details').filter({ has: page.getByText(`${profile} briefing`, { exact: true }) })
        await expect(task).toHaveCount(1)
        await task.locator('summary').click()
        await expect(task.getByText(`Prepare the ${profile} briefing`, { exact: true })).toBeVisible()
      }
      expect(requests.length).toBeGreaterThanOrEqual(3)
      expect(requests.every(profiles => profiles.length === 1)).toBe(true)
      expect([...new Set(requests.flat())].sort()).toEqual(['default', 'research', 'writer'])
      await surface.getByLabel('Profile', { exact: true }).selectOption('research')
      await expect(surface.locator('details')).toHaveCount(1)
      await expect(surface.getByText('research briefing', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Close Scheduled', exact: true }).click()
      await expect(editor(page)).toHaveText('Keep this Research draft while reviewing scheduled tasks')
      await expect(conversation).toHaveAttribute('data-browser-conversation-id', chatId)
      expect(new URL(page.url()).hash).toBe(chatRoute)
      await page.reload()
      if (width === 390) await selectResearchBot(page)
      await expect(editor(page)).toHaveText('Keep this Research draft while reviewing scheduled tasks')
      expect(errors).toEqual([])
    })
  })
}
