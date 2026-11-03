import { test, expect } from '@playwright/test'
import { createServer } from 'vite'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
let server, origin, cache
test.beforeAll(async () => {
  cache = mkdtempSync(path.join(tmpdir(), 'athena-session-row-'))
  server = await createServer({ configFile: false, root, cacheDir: cache,
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(path.join(root, 'node_modules'))] } },
    optimizeDeps: { entries: ['tests/browser/fixtures/session-row.html'], include: ['react', 'react-dom/client', 'react-dom', 'clsx', 'tailwind-merge'] }
  })
  await server.listen()
  origin = `http://127.0.0.1:${server.httpServer.address().port}`
})
test.afterAll(async () => { await server?.close(); if (cache) rmSync(cache, { recursive: true, force: true }) })

test('row commands preserve owner identity and exclude action and portal gestures', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/tests/browser/fixtures/session-row.html`)
  const research = page.getByRole('button', { name: 'Research conversation', exact: true })
  const writer = page.getByRole('button', { name: 'Writer conversation', exact: true })
  await research.click()
  const modifier = await page.evaluate(() => /Mac/i.test(navigator.platform) ? 'Meta' : 'Control')
  await writer.click({ modifiers: [modifier] })
  await research.click({ modifiers: ['Shift'] })
  await writer.click({ modifiers: ['Alt', 'Shift'] })
  await research.click({ button: 'middle' })
  await page.getByRole('button', { name: 'Reorder Writer conversation', exact: true }).press('Space')
  await page.getByRole('button', { name: 'Writer actions', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm Writer', exact: true }).click()
  expect(await page.evaluate(() => window.rowEvents)).toEqual([
    'Research:resume', 'Writer:resume', 'Research:pin', 'Writer:archive', 'Research:resume',
    'Writer:reorder', 'Writer:actions', 'Writer:portal'
  ])
  await expect(page.getByRole('textbox', { name: 'Draft', exact: true })).toHaveValue('Preserve this draft')
  // Inbox cards put actions inside the body; portal events must still be fenced.
  await page.getByRole('button', { name: 'Change density' }).click()
  await page.getByRole('button', { name: 'Research actions', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm Research', exact: true }).click()
  expect((await page.evaluate(() => window.rowEvents)).slice(-2)).toEqual(['Research:actions', 'Research:portal'])
  await writer.focus()
  await page.keyboard.press('Enter')
  expect((await page.evaluate(() => window.rowEvents)).at(-1)).toBe('Writer:resume')
  await expect(page.getByRole('textbox', { name: 'Draft', exact: true })).toHaveValue('Preserve this draft')
  expect(errors).toEqual([])
})
