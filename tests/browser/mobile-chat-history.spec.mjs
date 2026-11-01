import { test, expect } from '@playwright/test'
import { createServer } from 'vite'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
let server, origin, cache
test.beforeAll(async () => {
  cache = mkdtempSync(path.join(tmpdir(), 'athena-mobile-chat-history-'))
  server = await createServer({
    configFile: false, root, cacheDir: cache,
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(path.join(root, 'node_modules'))] } },
    optimizeDeps: { entries: ['tests/browser/fixtures/mobile-chat-history.html'], include: ['react', 'react-dom/client', 'react-router'] }
  })
  await server.listen()
  origin = `http://127.0.0.1:${server.httpServer.address().port}`
})
test.afterAll(async () => {
  await server?.close()
  if (cache) rmSync(cache, { recursive: true, force: true })
})
test.beforeEach(async ({ page }) => {
  await page.goto(`${origin}/tests/browser/fixtures/mobile-chat-history.html`)
  await expect(page.getByRole('region', { name: 'History' })).toBeVisible()
})

async function openChat(page, name = 'Open chat A') {
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.getByRole('region', { name: 'Conversation' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => history.state?.usr?.athenaMobileChat)).toBe(true)
}
async function historyHome(page) {
  await expect(page.getByRole('region', { name: 'History' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'History' })).toContainText('sessions')
}

test('toolbar and browser Back return to history while retaining the mounted draft', async ({ page }) => {
  await openChat(page)
  await expect(page.getByLabel('Route')).toHaveText('/chat-a')
  expect(await page.evaluate(() => history.state.usr.preserved)).toBe('owner')
  await page.getByRole('textbox', { name: 'Draft' }).fill('Unsent draft')
  await page.getByRole('button', { name: 'Back to chat history' }).click()
  await historyHome(page)
  await openChat(page, 'Reopen selected chat')
  await expect(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Unsent draft')
  await page.goBack()
  await historyHome(page)
  await openChat(page, 'Open chat B')
  await page.goBack()
  await historyHome(page)
  await expect(page.getByLabel('Route')).toHaveText('/chat-b')
})

test('Forward restores chat and overlays keep their own Back destination', async ({ page }) => {
  await openChat(page)
  await page.goBack()
  await historyHome(page)
  await page.goForward()
  await expect(page.getByRole('region', { name: 'Conversation' })).toBeVisible()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByLabel('Route')).toHaveText('/settings')
  await page.goBack()
  await expect(page.getByRole('region', { name: 'Conversation' })).toBeVisible()
  await page.goBack()
  await historyHome(page)
})

test('desktop navigation does not add mobile history entries', async ({ page }) => {
  await page.getByRole('button', { name: 'Toggle mobile' }).click()
  const length = await page.evaluate(() => history.length)
  await page.getByRole('button', { name: 'Open chat A', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Conversation' })).toBeVisible()
  expect(await page.evaluate(() => history.length)).toBe(length + 1)
  expect(await page.evaluate(() => history.state.usr.athenaMobileChat)).toBeUndefined()
})
