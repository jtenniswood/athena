import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

let application, origin
test.beforeAll(async () => { application = await createBuiltApplication(); origin = application.origin })
test.afterAll(async () => { await application?.close() })
const composer = page => page.locator('[data-slot="composer-rich-input"]:visible').first()
test.beforeEach(async ({ page }) => {
  await page.goto(`${origin}/#/preview-week`)
  await expect(composer(page)).toBeVisible({ timeout: 30000 })
  await composer(page).fill('Keep this plugin-file draft')
})

test('plugin file reads reject URLs that resolve outside their asset roots before fetching', async ({ page }) => {
  const outsideRequests = []
  await page.route(/\/api\/plugin-file-sentinel(?:\/|$)/, async route => {
    outsideRequests.push(route.request().url())
    await route.fulfill({ json: route.request().url().endsWith('/.listing') ? [{ name: 'outside', type: 'directory' }] : { outside: true } })
  })
  const results = await page.evaluate(async origin => {
    const paths = ['/plugins/../api/plugin-file-sentinel', '/desktop-plugins/%2e%2e/api/plugin-file-sentinel', '/plugins/nested/../../api/plugin-file-sentinel']
    return Promise.all(paths.map(async path => {
      let error
      try { await window.hermesDesktop.readFileText(origin + path) }
      catch (failure) { error = failure.message }
      return { error, directory: await window.hermesDesktop.readDir(origin + path) }
    }))
  }, origin)
  expect(outsideRequests).toEqual([])
  for (const result of results) {
    expect(result.error).toContain('local file access is unavailable')
    expect(result.directory).toEqual({ entries: [], error: 'local file access is unavailable in the web app' })
  }
  await expect(composer(page)).toHaveText('Keep this plugin-file draft')
})

test('plugin roots retain nested file reads and directory entry paths', async ({ page }) => {
  await page.route(/\/(?:plugins|desktop-plugins)\/review-widget\/(?:package\.json|\.listing)$/, async route => {
    await route.fulfill({ json: route.request().url().endsWith('/.listing')
      ? [{ name: 'assets', type: 'directory' }]
      : { name: 'review-widget' } })
  })
  for (const root of ['plugins', 'desktop-plugins']) {
    const directory = `${origin}/${root}/review-widget`
    const result = await page.evaluate(async directory => ({
      file: await window.hermesDesktop.readFileText(`${directory}/package.json`),
      directory: await window.hermesDesktop.readDir(directory)
    }), directory)
    expect(result.file).toEqual({ path: `${directory}/package.json`, text: JSON.stringify({ name: 'review-widget' }) })
    expect(result.directory).toEqual({ entries: [{ name: 'assets', path: `${directory}/assets`, isDirectory: true }] })
  }
  await expect(composer(page)).toHaveText('Keep this plugin-file draft')
})
