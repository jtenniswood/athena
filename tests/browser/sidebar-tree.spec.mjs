import { test, expect } from '@playwright/test'
import { createServer } from 'vite'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
let server, origin, cache
test.beforeAll(async () => {
  cache = mkdtempSync(path.join(tmpdir(), 'athena-sidebar-tree-'))
  server = await createServer({ configFile: false, root, cacheDir: cache,
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(path.join(root, 'node_modules'))] } },
    optimizeDeps: { entries: ['tests/browser/fixtures/sidebar-tree.html'], include: ['react', 'react-dom/client', 'clsx', 'tailwind-merge'] }
  })
  await server.listen()
  origin = `http://127.0.0.1:${server.httpServer.address().port}`
})
test.afterAll(async () => { await server?.close(); if (cache) rmSync(cache, { recursive: true, force: true }) })

// Browser startup deliberately parks project drill-in at the overview. Exercise
// its reusable tree views independently without changing that product policy.
test('tree views show every row and preserve disclosure, live owner commands and the draft', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/tests/browser/fixtures/sidebar-tree.html`)
  const repo = page.getByRole('button', { name: 'Repository A', exact: true })
  const lane = page.getByRole('button', { name: 'feature/keep-distinct-tail', exact: true })
  const last = page.getByRole('button', { name: 'Worktree conversation 6', exact: true })
  await expect(page.getByRole('button', { name: /Show .*more conversations/ })).toHaveCount(0)
  await expect(last).toBeVisible()
  await page.getByRole('button', { name: 'New conversation in Research', exact: true }).click()
  await page.getByRole('button', { name: 'Change owner', exact: true }).click()
  await page.getByRole('button', { name: 'New conversation in Writer', exact: true }).click()
  await lane.click()
  await expect(lane).toHaveAttribute('aria-expanded', 'false')
  await expect(last).toHaveCount(0)
  await expect(lane).toBeFocused()
  await lane.press('Space')
  await expect(last).toBeVisible()
  await repo.click()
  await expect(lane).toHaveCount(0)
  await repo.press('Enter')
  await expect(lane).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Draft', exact: true })).toHaveValue('Preserve this tree draft')
  expect(await page.evaluate(() => window.treeEvents)).toEqual(['Research:create', 'Writer:create'])
  expect(errors).toEqual([])
})
