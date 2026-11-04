import { test, expect } from '@playwright/test'
import { createServer } from 'vite'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
let server, origin, cache
test.beforeAll(async () => {
  cache = mkdtempSync(path.join(tmpdir(), 'athena-display-scale-'))
  server = await createServer({ configFile: false, root, cacheDir: cache,
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(path.join(root, 'node_modules'))] } },
    optimizeDeps: { entries: ['tests/browser/fixtures/display-scale.html'], include: ['react'] }
  })
  await server.listen()
  origin = `http://127.0.0.1:${server.httpServer.address().port}`
})
test.afterAll(async () => { await server?.close(); if (cache) rmSync(cache, { recursive: true, force: true }) })
const open = async page => { await page.goto(`${origin}/tests/browser/fixtures/display-scale.html`); await expect(page.getByLabel('Scale')).toHaveText('125') }
const scale = async (page, value) => {
  await expect(page.getByLabel('Scale')).toHaveText(String(value))
  await expect.poll(() => page.evaluate(() => Number(document.documentElement.style.zoom))).toBe(value / 100)
}

test('scale changes share the preference owner across tabs and keep draft focus', async ({ page }) => {
  await open(page)
  const other = await page.context().newPage()
  try {
    await open(other)
    await other.getByRole('textbox', { name: 'Draft' }).fill('Unsent in another tab')
    await page.evaluate(() => window.preference('desktopScale').write(150))
    await scale(page, 150)
    await scale(other, 150)
    await expect(other.getByRole('textbox', { name: 'Draft' })).toHaveValue('Unsent in another tab')
    await expect(other.getByRole('textbox', { name: 'Draft' })).toBeFocused()
    expect(await page.evaluate(() => window.changes)).toEqual([150])
    expect(await other.evaluate(() => window.changes)).toEqual([150])
    await other.evaluate(() => window.zoom.setPercent(175))
    await scale(other, 175)
    await scale(page, 175)
    expect(await other.evaluate(() => window.changes)).toEqual([150, 175])
  } finally { await other.close() }
})

test('local scale commands survive a blocked optional save and keep editor shortcuts unchanged', async ({ page }) => {
  await open(page)
  await page.evaluate(() => {
    const save = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new Error('Storage blocked') }
    try { window.zoom.setPercent(150) } finally { Storage.prototype.setItem = save }
  })
  await scale(page, 150)
  expect(await page.evaluate(() => window.changes)).toEqual([150])
  const modifier = await page.evaluate(() => /Mac/i.test(navigator.platform) ? 'Meta' : 'Control')
  await page.getByRole('textbox', { name: 'Draft' }).press(`${modifier}+Equal`)
  await scale(page, 150)
  await expect(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Keep this draft')
  await page.getByRole('button', { name: 'Focus outside editor' }).press(`${modifier}+Equal`)
  await expect.poll(() => page.evaluate(async () => (await window.zoom.get()).percent)).toBeGreaterThan(150)
  expect(await page.evaluate(() => window.changes.length)).toBe(2)
})

test.describe('touch display preferences', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })
  test('responsive changes select the existing mobile or desktop scale without copying it', async ({ page }) => {
    await open(page)
    await page.evaluate(() => { window.preference('mobileScale').write(150); window.preference('desktopScale').write(175) })
    await scale(page, 150)
    await page.getByRole('textbox', { name: 'Draft' }).fill('Preserve while resizing')
    await page.setViewportSize({ width: 1200, height: 900 })
    await scale(page, 175)
    await page.setViewportSize({ width: 390, height: 844 })
    await scale(page, 150)
    expect(await page.evaluate(() => [window.preference('mobileScale').read(), window.preference('desktopScale').read()])).toEqual([150, 175])
    await expect(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Preserve while resizing')
  })
})
