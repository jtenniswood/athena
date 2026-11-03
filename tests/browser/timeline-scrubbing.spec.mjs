import { test, expect } from '@playwright/test'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rendererAdapterPlugin } from '../../scripts/renderer-adapter.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
let server, origin, cache
test.beforeAll(async () => {
  cache = mkdtempSync(path.join(tmpdir(), 'athena-timeline-'))
  server = await createServer({ configFile: false, root, cacheDir: cache,
    plugins: [rendererAdapterPlugin(path.join(root, 'apps/web-desktop')), react()],
    resolve: { alias: { '@/components/ui/tooltip': path.join(root, 'tests/browser/fixtures/timeline-tooltip.tsx') }, dedupe: ['react', 'react-dom'] },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(path.join(root, 'apps/desktop')), realpathSync(path.join(root, 'node_modules'))] } },
    optimizeDeps: { entries: ['tests/browser/fixtures/timeline-scrubbing.html'], include: ['react', 'react-dom/client', '@tanstack/react-virtual'] }
  })
  await server.listen()
  origin = `http://127.0.0.1:${server.httpServer.address().port}`
})
test.afterAll(async () => { await server?.close(); if (cache) rmSync(cache, { recursive: true, force: true }) })

test.beforeEach(async ({ page }) => {
  await page.goto(`${origin}/tests/browser/fixtures/timeline-scrubbing.html`)
  await expect(page.getByRole('button', { name: 'research message 0', exact: true })).toBeVisible()
})

const jumps = page => page.evaluate(() => window.timelineJumps)
async function position(page, owner, index) {
  return page.getByTestId(owner).locator('[data-slot="thread-timeline-ticks"]').evaluate((rail, index) => {
    const rect = rail.getBoundingClientRect(), scale = rect.height / rail.offsetHeight
    const pitch = Number.parseFloat(rail.querySelector('button').style.height)
    return { x: rect.right - 12, y: rect.top + ((index + .5) * pitch - rail.scrollTop) * scale }
  }, index)
}

test('timeline drags call the owning command once per entry without synthetic clicks', async ({ page }) => {
  const start = await position(page, 'research', 0), end = await position(page, 'research', 5)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y)
  await page.mouse.move(end.x - 1, end.y)
  await page.mouse.up()
  expect(await jumps(page)).toEqual(['research-5'])
  expect(await page.evaluate(() => window.timelineSyntheticClicks)).toBe(0)
  await expect(page.getByLabel('Draft')).toHaveValue('Preserve this draft')
  expect(await page.getByTestId('research').locator('button').count()).toBeLessThan(60)

  await page.getByRole('button', { name: 'research message 2', exact: true }).click()
  await page.getByRole('button', { name: 'research message 2', exact: true }).press('ArrowDown')
  await expect(page.getByRole('button', { name: 'research message 3', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  expect(await jumps(page)).toEqual(['research-5', 'research-2', 'research-3'])
})

test('timeline dragging respects virtual scroll offsets and UI scale', async ({ page }) => {
  await page.getByRole('button', { name: 'Scale UI', exact: true }).click()
  await page.getByTestId('research').locator('[data-slot="thread-timeline-ticks"]').evaluate(rail => { rail.scrollTop = 700 })
  await expect(page.getByRole('button', { name: 'research message 100', exact: true })).toBeVisible()
  const start = await position(page, 'research', 101), end = await position(page, 'research', 106)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y)
  await page.mouse.up()
  expect(await jumps(page)).toEqual(['research-106'])
})

test('timeline gestures cannot cross owners or survive replacement and unmount', async ({ page }) => {
  const start = await position(page, 'research', 0), end = await position(page, 'research', 5)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y)
  const other = await position(page, 'other', 8)
  await page.mouse.move(other.x, other.y)
  await page.mouse.up()
  expect(await jumps(page)).toEqual(['research-5'])

  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y)
  await page.getByRole('button', { name: 'Change conversation', exact: true }).evaluate(button => button.click())
  await page.mouse.move(end.x, end.y + 14)
  await page.mouse.up()
  expect(await jumps(page)).toEqual(['research-5', 'research-5'])

  const writer = await position(page, 'writer', 0)
  await page.mouse.move(writer.x, writer.y)
  await page.mouse.down()
  await page.getByRole('button', { name: 'Toggle rail', exact: true }).evaluate(button => button.click())
  await page.mouse.move(other.x, other.y)
  await page.mouse.up()
  expect(await jumps(page)).toEqual(['research-5', 'research-5'])
})

test('timeline scrubbing continues when entries refresh within the same owner', async ({ page }) => {
  const start = await position(page, 'research', 0), middle = await position(page, 'research', 5), end = await position(page, 'research', 8)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(middle.x, middle.y)
  await page.getByRole('button', { name: 'Refresh entries', exact: true }).evaluate(button => button.click())
  await page.mouse.move(end.x, end.y)
  await page.mouse.up()
  expect(await jumps(page)).toEqual(['research-5', 'research-8'])
})

test('timeline scrubbing stops when the command owner changes with stable entries', async ({ page }) => {
  const start = await position(page, 'research', 0), middle = await position(page, 'research', 5), end = await position(page, 'research', 8)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(middle.x, middle.y)
  await page.getByRole('button', { name: 'Replace command owner', exact: true }).evaluate(button => button.click())
  await page.mouse.move(end.x, end.y)
  await page.mouse.up()
  expect(await jumps(page)).toEqual(['research-5'])
})
