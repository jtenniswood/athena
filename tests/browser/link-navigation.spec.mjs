import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createPreviewGateway } from '../../scripts/preview/gateway.mjs'
import { getBrowserTarget } from './test-target.mjs'

const { image, url } = getBrowserTarget()
test.skip(!image && !url && !process.env.CI, 'Set HERMES_TEST_IMAGE or HERMES_BROWSER_PREVIEW_URL')
test.setTimeout(90000)
let gateway, container, origin

test.beforeAll(async () => {
  if (url) { origin = url; return }
  gateway = createPreviewGateway()
  await new Promise(resolve => gateway.server.listen(0, '0.0.0.0', resolve))
  container = execFileSync('docker', [
    'run', '-d', '--rm', '--add-host', 'host.docker.internal:host-gateway', '-p', '127.0.0.1::80',
    '-e', `HERMES_GATEWAY_URL=http://host.docker.internal:${gateway.server.address().port}`, image
  ], { encoding: 'utf8' }).trim()
  origin = `http://127.0.0.1:${execFileSync('docker', ['port', container, '80/tcp'], { encoding: 'utf8' }).trim().split(':').at(-1)}`
  await expect.poll(async () => { try { return (await fetch(origin)).status } catch { return 0 } }).toBe(200)
})
test.afterAll(async () => {
  if (container) execFileSync('docker', ['stop', container], { stdio: 'ignore' })
  await gateway?.close()
})

const external = 'https://example.com/reference'
const response = `Chat references: @session:default/preview-idea and @session:research/preview-research.\n\n[Web reference](${external})`
const editor = page => page.locator('[contenteditable="true"]:visible').first()

async function openReferences(page) {
  const update = rows => {
    const assistant = rows?.findLast(row => row.role === 'assistant')
    if (assistant) assistant.content = response
    const user = rows?.find(row => row.role === 'user')
    if (user) user.content = 'User reference: @session:default/preview-idea'
  }
  await page.routeWebSocket(/\/api\/ws/, socket => {
    const server = socket.connectToServer()
    server.onMessage(message => {
      const frame = JSON.parse(String(message))
      update(frame.result?.messages)
      socket.send(JSON.stringify(frame))
    })
  })
  await page.route(/\/api\/sessions\/preview-week\/messages/, async route => {
    const upstream = await route.fetch(), body = await upstream.json()
    update(body.messages)
    await route.fulfill({ response: upstream, json: body })
  })
  await page.goto(`${origin}/#/preview-week`)
  await expect(page.getByRole('link', { name: 'Web reference', exact: true })).toBeVisible({ timeout: 30000 })
  await expect(page.locator('.athena-connecting-overlay')).toBeHidden({ timeout: 30000 })
  await editor(page).fill('Keep my draft while opening references')
}

function expectNoDesktopTabs(page) {
  return expect(page.getByRole('menuitem', { name: /^(Close others|Close to the right|Close all|Hide tabs|Show tabs|Toggle tab strip)$/ })).toHaveCount(0)
}

test('chat references open real browser tabs and preserve the original draft', async ({ page }) => {
  await openReferences(page)
  const links = page.locator('a[title="default/preview-idea"]')
  await expect(links).toHaveCount(2) // User chip and assistant reference both expose real URLs.
  for (const [link, gesture] of [
    [links.first(), 'click'], [links.last(), 'click'], [links.last(), 'keyboard'],
    [links.last(), 'modifier'], [links.last(), 'middle'],
    [page.locator('a[title="research/preview-research"]'), 'click']
  ]) {
    const destination = await link.getAttribute('href')
    await expect(link).toHaveAttribute('target', '_blank')
    if (gesture === 'keyboard') {
      for (let step = 0; step < 40 && !await link.evaluate(element => element === document.activeElement); step++) {
        await page.keyboard.press('Shift+Tab')
      }
      await expect(link).toBeFocused()
    }
    const popupPromise = page.waitForEvent('popup')
    if (gesture === 'keyboard') await link.press('Enter')
    else await link.click(gesture === 'modifier' ? { modifiers: ['ControlOrMeta'] } : gesture === 'middle' ? { button: 'middle' } : {})
    const popup = await popupPromise
    await expect(popup).toHaveURL(destination)
    expect(await popup.evaluate(() => window.opener)).toBeNull()
    await expect(editor(popup)).toBeVisible({ timeout: 30000 })
    if (destination.endsWith('/preview-research')) {
      await expect(popup.getByText('I can help you investigate a question, compare approaches, and organize your findings. What are you curious about?', { exact: true })).toBeVisible()
    }
    await popup.close()
    await expect(page).toHaveURL(`${origin}/#/preview-week`)
    await expect(editor(page)).toHaveText('Keep my draft while opening references')
  }
})

test('link context menus open browser tabs and copy URLs without desktop tab controls', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await context.route(external, route => route.fulfill({ contentType: 'text/html', body: '<h1>Reference destination</h1>' }))
  await openReferences(page)
  for (const link of [page.locator('a[title="default/preview-idea"]').last(), page.getByRole('link', { name: 'Web reference', exact: true })]) {
    const destination = await link.getAttribute('href')
    await link.click({ button: 'right' })
    await expectNoDesktopTabs(page)
    await expect(page.getByRole('menuitem', { name: /Open in (?:Hermes|app)/ })).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Copy URL', exact: true }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(destination)
    await link.click({ button: 'right' })
    const popupPromise = page.waitForEvent('popup')
    await page.getByRole('menuitem', { name: 'Open in browser tab', exact: true }).click()
    const popup = await popupPromise
    await expect(popup).toHaveURL(destination)
    await popup.close()
    await expect(editor(page)).toHaveText('Keep my draft while opening references')
  }
  await page.getByText('Chat references:', { exact: false }).first().click({ button: 'right', position: { x: 5, y: 5 } })
  await expect(page.getByRole('menuitem', { name: 'Reload', exact: true })).toBeVisible()
  await expectNoDesktopTabs(page)
  await page.keyboard.press('Escape')
  await page.locator('[data-web-session-id="preview-idea"]').first().click({ button: 'right' })
  await expectNoDesktopTabs(page)
  await page.keyboard.press('Escape')
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.locator('[data-browser-command-palette]')
  await palette.getByRole('combobox').fill('Toggle tabs')
  await expect(palette.getByRole('option', { name: /Toggle tabs/ })).toHaveCount(0)
})
