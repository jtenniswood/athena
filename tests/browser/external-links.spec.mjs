import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

let application, origin
test.beforeAll(async () => { application = await createBuiltApplication(); origin = application.origin })
test.afterAll(async () => { await application?.close() })
const editor = page => page.locator('[data-slot="composer-rich-input"]:visible').first()
test.beforeEach(async ({ page }) => {
  await page.goto(`${origin}/#/preview-week`)
  await expect(editor(page)).toBeVisible({ timeout: 30000 })
  await editor(page).fill('Keep this draft while opening links')
  await page.evaluate(() => { window.openedLinks = []; window.open = (...args) => { window.openedLinks.push(args); return null } })
})

test('external and preview bridge commands apply the upstream browser URL policy', async ({ page }) => {
  const opened = await page.evaluate(async () => {
    const bridge = window.hermesDesktop
    const commands = [bridge.openExternal, bridge.openPreviewInBrowser]
    for (const url of [
      'javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)', 'hermes-media://stream/private', 'file:///private/example.txt',
      'blob:https://example.com/unowned', 'not a URL', '/relative/path', ''
    ]) for (const command of commands) await command(url)
    const refusedCount = window.openedLinks.length
    for (const url of [' https://example.com/a b ', 'http://example.com/path', 'mailto:someone@example.com']) {
      for (const command of commands) await command(url)
    }
    return { refusedCount, links: window.openedLinks }
  })
  expect(opened.refusedCount).toBe(0)
  expect(opened.links).toEqual(['https://example.com/a%20b', 'http://example.com/path', 'mailto:someone@example.com']
    .flatMap(url => [[url, '_blank', 'noopener,noreferrer'], [url, '_blank', 'noopener,noreferrer']]))
  await expect(page).toHaveURL(`${origin}/#/preview-week`)
  await expect(editor(page)).toHaveText('Keep this draft while opening links')
})

test('the browser link menu uses the same opener while preserving its conversation', async ({ page }) => {
  await page.evaluate(() => {
    const link = document.createElement('a')
    link.href = 'https://example.com/reference'; link.textContent = 'External reference'
    document.body.prepend(link)
  })
  await page.getByRole('link', { name: 'External reference', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open in browser tab', exact: true }).click()
  expect(await page.evaluate(() => window.openedLinks)).toEqual([['https://example.com/reference', '_blank', 'noopener,noreferrer']])
  await expect(page).toHaveURL(`${origin}/#/preview-week`)
  await expect(editor(page)).toHaveText('Keep this draft while opening links')
})
