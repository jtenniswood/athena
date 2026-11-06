import { waitForBrowserNetwork } from './network-readiness.mjs'
import { test as base, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createPreviewGateway } from '../../scripts/preview/gateway.mjs'
import { getBrowserTarget } from './test-target.mjs'
import { createBuiltApplication } from './built-application.mjs'

export const test = base.extend({
  // Docker changes network interfaces between tests. Launch a fresh browser
  // after the container is ready so cached network state cannot abort assets.
  context: async ({ gatewayApp, playwright, browserName, contextOptions, viewport }, use, testInfo) => {
    const browser = await playwright[browserName].launch()
    try {
      const readiness = await waitForBrowserNetwork(browser, gatewayApp.origin)
      await testInfo.attach('fixture-network-readiness', { body: JSON.stringify(readiness), contentType: 'application/json' })
      const context = await browser.newContext({ ...contextOptions, viewport })
      await use(context)
      await context.close()
    } finally { await browser.close() }
  },
  // Start Docker before opening a browser page, so interface creation cannot
  // interrupt the app's first asset requests with ERR_NETWORK_CHANGED.
  page: async ({ gatewayApp, context }, use) => {
    void gatewayApp
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await use(page)
    await page.close()
    expect(errors, 'Unhandled browser exceptions').toEqual([])
  },
  gatewayApp: async ({}, use, testInfo) => {
    const { image, url } = getBrowserTarget()
    if (url) throw new Error('Interruption tests require their own isolated gateway.')
    const application = image ? null : await createBuiltApplication({ strict: true })
    const gateway = application?.gateway || createPreviewGateway({ strict: true })
    let container, origin = application?.origin
    try {
      if (image) {
        await new Promise(resolve => gateway.server.listen(0, '0.0.0.0', resolve))
        container = execFileSync('docker', ['run', '-d', '--rm', '--add-host', 'host.docker.internal:host-gateway', '-p', '127.0.0.1::80', '-e', `HERMES_GATEWAY_URL=http://host.docker.internal:${gateway.server.address().port}`, image], { encoding: 'utf8' }).trim()
        const port = execFileSync('docker', ['port', container, '80/tcp'], { encoding: 'utf8' }).trim().split(':').at(-1)
        origin = `http://127.0.0.1:${port}`
        await expect.poll(async () => { try { return (await fetch(origin)).status } catch { return 0 } }).toBe(200)
      }
      await use({ ...gateway, origin })
    } finally {
      gateway.controls.releaseAll()
      await testInfo.attach('gateway-operations', { body: JSON.stringify({ calls: gateway.controls.calls, unexpected: gateway.controls.unexpected }, (_key, value) => typeof value === 'string' && value.length > 1000 ? `${value.slice(0, 200)}… (${value.length} characters)` : value, 2), contentType: 'application/json' })
      if (container) execFileSync('docker', ['stop', container], { stdio: 'ignore' })
      if (application) await application.close()
      else await gateway.close()
    }
    gateway.controls.assertExpected()
  }
})

export const editor = page => page.locator('[contenteditable="true"]:visible').first()
export async function openConversation(page, origin, session = 'preview-week') {
  // Selection-race scenarios use the profile rail, a supported saved layout.
  await page.addInitScript(() => {
    const key = 'hermes-web.browser.hermes.desktop.sidebarGrouping.allProfiles'
    if (localStorage.getItem(key) === null) localStorage.setItem(key, 'none')
  })
  await page.goto(`${origin}/#/${session}`)
  // Touch-first startup opens chat history until a conversation is explicitly opened.
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches && (matchMedia('(width < 48rem)').matches || matchMedia('(max-height: 27rem)').matches))) {
    await page.locator(`[data-web-session-id="${session}"] .browser-session-title`).first().click()
  }
  await expect(editor(page)).toBeVisible({ timeout: 30000 })
  await expect(page.locator('[data-browser-conversation-id]')).toHaveAttribute('data-browser-conversation-id', session)
  await expect(page.getByText('Help me make a thoughtful plan.', { exact: true }).first()).toBeVisible()
}

// Observe the actual browser response, then allow its state updates to render.
// A request count alone cannot prove that a held response has been processed.
export function observeResponses(page) {
  const responses = []
  page.on('websocket', socket => {
    const requests = new Map()
    socket.on('framesent', ({ payload }) => {
      try { const frame = JSON.parse(String(payload)); requests.set(frame.id, frame) } catch { /* Ignore transport frames. */ }
    })
    socket.on('framereceived', ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload))
        if (frame.id !== undefined) responses.push({ ...frame, request: requests.get(frame.id) })
      } catch { /* Ignore transport frames. */ }
    })
  })
  return async hold => {
    const call = await hold.entered
    const before = responses.length
    hold.release()
    await expect.poll(() => responses.slice(before).some(frame => frame.id === call.id && frame.request?.method === call.method && JSON.stringify(frame.request.params || {}) === JSON.stringify(call.params))).toBe(true)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  }
}
