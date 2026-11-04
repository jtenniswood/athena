import { test, expect } from '@playwright/test'
import { createServer } from 'vite'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
let server, origin, cache
test.beforeAll(async () => {
  cache = mkdtempSync(path.join(tmpdir(), 'athena-settings-model-'))
  server = await createServer({ configFile: false, root, cacheDir: cache,
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(path.join(root, 'node_modules'))] } },
    optimizeDeps: { entries: ['tests/browser/fixtures/settings-presentation.html'], include: ['react', 'react-dom/client'] }
  })
  await server.listen()
  origin = `http://127.0.0.1:${server.httpServer.address().port}`
})
test.afterAll(async () => { await server?.close(); if (cache) rmSync(cache, { recursive: true, force: true }) })
test.beforeEach(async ({ page }) => {
  await page.goto(`${origin}/tests/browser/fixtures/settings-presentation.html`)
  await expect.poll(() => page.evaluate(() => window.nativeModels?.at(-1)?.title)).toBe('A settings')
})
async function native(page, label, value) {
  await page.evaluate(({ label, value }) => {
    const row = window.nativeModels.at(-1).rows.find(row => row.label === label)
    if (!row?.id) throw Error('Missing explicit field: ' + label)
    window.nativeCommand(row.id, value)
  }, { label, value })
}

test('web and native controls use the same committed React values after Strict Mode remounts', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Web edit')
  await expect.poll(() => page.evaluate(() => window.nativeModels.at(-1).rows.find(row => row.label === 'Display name').value)).toBe('Web edit')
  await native(page, 'Display name', 'Native edit')
  await expect(page.getByRole('textbox', { name: 'Display name', exact: true })).toHaveValue('Native edit')
  await native(page, 'Enabled')
  await expect(page.getByRole('checkbox', { name: 'Enabled', exact: true })).not.toBeChecked()
  await page.getByRole('button', { name: 'Change availability', exact: true }).click()
  await native(page, 'Enabled')
  await expect(page.getByRole('checkbox', { name: 'Enabled', exact: true })).not.toBeChecked()
  expect(await page.evaluate(() => JSON.stringify(window.nativeModels))).not.toContain('private-fixture-secret')
  await native(page, 'Secret', 'replacement')
  await expect(page.getByLabel('Secret', { exact: true })).toHaveValue('replacement')
})

test('profile and component replacement invalidate old native commands without modifying another editor', async ({ page }) => {
  const stale = await page.evaluate(() => window.nativeModels.at(-1).rows.find(row => row.label === 'Display name').id)
  await page.getByRole('button', { name: 'Switch profile' }).click()
  await expect.poll(() => page.evaluate(() => window.nativeModels.at(-1).title)).toBe('B settings')
  await page.evaluate(id => window.nativeCommand(id, 'Wrong owner'), stale)
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('B name')
  await native(page, 'Display name', 'B edit')
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('B edit')
  const previousPage = await page.evaluate(() => window.nativeModels.at(-1).id)
  await page.getByRole('button', { name: 'Toggle Settings' }).click()
  await expect(page.getByLabel('Display name', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Toggle Settings' }).click()
  await expect.poll(() => page.evaluate(() => window.nativeModels.at(-1).id)).not.toBe(previousPage)
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('B name')
  await native(page, 'Display name', 'Remounted edit')
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Remounted edit')
})

test('native edits join the original pending-save barrier and failed writes remain unsafe', async ({ page }) => {
  await page.evaluate(() => { window.holdSave = true })
  await native(page, 'Display name', 'Pending value')
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Pending value')
  await page.evaluate(() => { window.prepared = null; void window.prepare().then(value => { window.prepared = value }) })
  await expect.poll(() => page.evaluate(() => typeof window.finishSave)).toBe('function')
  expect(await page.evaluate(() => window.prepared)).toBeNull()
  await page.evaluate(() => { window.failSave = true; window.finishSave() })
  await expect.poll(() => page.evaluate(() => window.prepared?.ready)).toBe(false)
  expect(await page.evaluate(() => window.saved)).toEqual([])
})
