import { test, expect } from '@playwright/test'
import { createServer } from 'vite'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
let server, origin, cache
test.beforeAll(async () => {
  cache = mkdtempSync(path.join(tmpdir(), 'athena-navigation-commands-'))
  server = await createServer({ configFile: false, root, cacheDir: cache,
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(path.join(root, 'node_modules'))] } },
    plugins: [{ name: 'navigation-fixture-surfaces', load(id) {
      // Sidebar section discovery and renderer visual primitives are unrelated
      // to these commands; retain the actual navigation hook and sidebar views.
      if (id.endsWith('/experience/sidebar-sections.tsx')) return 'export function useBrowserSidebarSections() { return {} }'
      if (id.endsWith('/upstream/browser-api.tsx')) return 'export function Codicon() { return null }; export function Tip({children}) { return children }'
    } }],
    optimizeDeps: { noDiscovery: true, entries: ['tests/browser/fixtures/navigation-commands.html'], include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-router', 'nanostores', 'clsx', 'tailwind-merge'] }
  })
  await server.listen()
  origin = `http://127.0.0.1:${server.httpServer.address().port}`
})
test.afterAll(async () => { await server?.close(); if (cache) rmSync(cache, { recursive: true, force: true }) })
test.use({ viewport: { width: 700, height: 800 }, hasTouch: false })
test.beforeEach(async ({ page }) => {
  await page.goto(`${origin}/tests/browser/fixtures/navigation-commands.html`)
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await expect(page.getByRole('region', { name: 'Navigation' })).toBeVisible()
})

for (const name of ['Create workspace chat', 'Create project chat']) {
  test(`${name} retains navigation without presentation classes`, async ({ page }) => {
    const command = page.getByRole('button', { name, exact: true })
    await command.evaluate(node => node.removeAttribute('class'))
    await command.click()
    await expect(page.getByLabel('Selection', { exact: true })).toHaveText('1')
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expect(page.getByRole('region', { name: 'Navigation' })).toBeVisible()
    await command.evaluate(node => node.removeAttribute('class'))
    await command.focus()
    await command.press('Enter')
    await expect(page.getByLabel('Selection', { exact: true })).toHaveText('2')
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expect(page.getByRole('region', { name: 'Navigation' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Preserve this draft')
  })
}

test('unrelated controls cannot preserve navigation through a shared CSS class', async ({ page }) => {
  await page.getByRole('button', { name: 'Unrelated selection', exact: true }).click()
  await expect(page.getByLabel('Selection', { exact: true })).toHaveText('1')
  await expect(page.getByRole('region', { name: 'Navigation' })).toBeHidden()
  await expect(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Preserve this draft')
})
