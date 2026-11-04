import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createBuiltApplication } from './built-application.mjs'

let app
test.use({ serviceWorkers: 'block' })
test.setTimeout(60000)
test.beforeAll(async () => {
  app = await createBuiltApplication({ async prepareHome(home) {
    const directory = path.join(home, 'desktop-plugins', 'notification-fixture')
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'plugin.js'), `export default { id: 'notification-fixture', name: 'Notification fixture', register(ctx) {
      window.pluginBodyClicks = 0; window.pluginActionClicks = 0;
      window.emitPluginNotification = (activate = '/settings?tab=plugins') => ctx.os.notify({
        title: 'Plugin result ready', activate,
        onActivate: () => { window.pluginBodyClicks++; if (window.pluginCallbackPath) location.hash = window.pluginCallbackPath },
        actions: [{ id: 'details', label: 'Open details', activate: '/settings?tab=config%3Abrowser-configuration', onAction: () => { window.pluginActionClicks++ } }]
      });
      ctx.onDispose(() => { delete window.emitPluginNotification });
    } }`)
  } })
})
test.afterAll(async () => { await app?.close() })
const editor = page => page.locator('[data-slot="composer-rich-input"]:visible').first()

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    // Headless app pages can all report focus; model the user leaving Athena.
    const hasFocus = document.hasFocus.bind(document)
    document.hasFocus = () => !window.pluginAway && hasFocus()
    window.pluginAlerts = []
    window.Notification = class {
      static permission = 'granted'
      constructor(title, options) {
        if (options.actions?.length) throw new TypeError('Page notification actions are unsupported')
        this.options = options; window.pluginAlerts.push(this)
      }
      close() { this.onclose?.() }
    }
    if (typeof ServiceWorkerRegistration !== 'undefined') {
      ServiceWorkerRegistration.prototype.showNotification = async function (_title, options) {
        if (window.fixtureDisplayDelay) await new Promise(resolve => setTimeout(resolve, window.fixtureDisplayDelay))
        window.pluginAlerts.push({ options })
        if (options.tag) localStorage.setItem(`fixture-notification:${options.tag}`, JSON.stringify(options.data))
      }
      ServiceWorkerRegistration.prototype.getNotifications = async function ({ tag } = {}) {
        const data = tag && localStorage.getItem(`fixture-notification:${tag}`)
        return data ? [{ data: JSON.parse(data) }] : []
      }
    }
  })
})
async function openApp(page, draft = 'Keep the plugin notification draft', session = 'preview-week') {
  await page.goto(`${app.origin}/#/${session}`)
  await expect(editor(page)).toBeVisible()
  await expect.poll(() => page.evaluate(() => typeof window.emitPluginNotification)).toBe('function')
  await editor(page).fill(draft)
  await page.evaluate(() => {
    const notify = window.hermesDesktop.notify
    window.pluginReadyAt = Date.now()
    window.hermesDesktop.notify = payload => {
      if (payload.kind === 'plugin') window.pluginPayload = payload
      return notify(payload).then(delivered => { if (payload.kind === 'plugin') window.pluginDelivery = delivered; return delivered })
    }
  })
}
async function background(source, context) {
  const peer = await context.newPage()
  await peer.goto('about:blank')
  await peer.bringToFront()
  await source.evaluate(() => { window.pluginAway = true })
  await expect.poll(() => source.evaluate(() => document.hidden || !document.hasFocus())).toBe(true)
  return peer
}
async function emit(page, activate) {
  await page.evaluate(() => { window.pluginAway = true })
  await expect.poll(async () => {
    if (!await page.evaluate(() => window.pluginPayload)) await page.evaluate(activate => window.emitPluginNotification(activate), activate)
    return page.evaluate(() => Boolean(window.pluginPayload))
  }, { timeout: 10000 }).toBe(true)
  await expect.poll(() => page.evaluate(() => typeof window.pluginDelivery)).toBe('boolean')
  return page.evaluate(() => window.pluginAlerts.at(-1)?.options.data)
}

test('page plugin notification clicks invoke the mounted plugin once and preserve its chat draft', async ({ page, context }) => {
  await openApp(page)
  const away = await background(page, context)
  const data = await emit(page)
  expect(data.url).toBe(`${app.origin}/#/settings?tab=plugins`)
  await page.evaluate(() => { window.pluginAlerts[0].onclick(); window.pluginAlerts[0].onclick() })
  await expect(page).toHaveURL(`${app.origin}/#/settings?tab=plugins`)
  expect(await page.evaluate(() => [window.pluginBodyClicks, window.pluginActionClicks])).toEqual([1, 0])
  await page.goBack()
  await expect(editor(page)).toHaveText('Keep the plugin notification draft')
  await away.close()
})

test('page plugin notification dismissal releases its callbacks', async ({ page, context }) => {
  await openApp(page)
  const away = await background(page, context)
  await emit(page)
  await page.evaluate(() => { window.pluginAlerts[0].onclose(); window.pluginAlerts[0].onclick() })
  expect(await page.evaluate(() => [window.pluginBodyClicks, window.pluginActionClicks])).toEqual([0, 0])
  await expect(page).toHaveURL(`${app.origin}/#/settings?tab=plugins`)
  await away.close()
})

test.describe('persistent plugin notifications', () => {
  test.use({ serviceWorkers: 'allow' })
  test.beforeEach(async ({ browserName }) => { test.skip(browserName !== 'chromium', 'Playwright exposes service-worker control in Chromium') })

  async function ready(page) {
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  }
  async function click(context, data, action = '') {
    await context.serviceWorkers()[0].evaluate(async ({ data, action }) => {
      // The OS supplies transient activation; synthetic clicks only stub native focus.
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const prototype = clients[0] && Object.getPrototypeOf(clients[0]), focus = prototype?.focus
      if (prototype) prototype.focus = async function () { return this }
      try { await self.handleNotificationClick(data, action) }
      finally { if (prototype) prototype.focus = focus }
    }, { data, action })
  }
  async function send(context, source, notifyId, dismiss = false) {
    return context.serviceWorkers()[0].evaluate(async ({ source, notifyId, dismiss }) => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      return Promise.all(clients.map(client => self.requestNotificationClient(client, { type: 'ATHENA_NOTIFICATION_ACTIVATE', source, notifyId, dismiss })))
    }, { source, notifyId, dismiss })
  }

  test('persistent clicks prefer the callback owner over another matching app window', async ({ page, context }) => {
    await openApp(page, 'Keep the source draft')
    await ready(page)
    const peer = await context.newPage()
    await openApp(peer, 'Keep the peer draft')
    await ready(peer)
    await peer.bringToFront()
    const data = await emit(page)
    await click(context, data)
    await expect(page).toHaveURL(`${app.origin}/#/settings?tab=plugins`)
    await expect(peer).toHaveURL(`${app.origin}/#/preview-week`)
    expect(await page.evaluate(() => [window.pluginBodyClicks, window.pluginActionClicks])).toEqual([1, 0])
    expect(await peer.evaluate(() => [window.pluginBodyClicks, window.pluginActionClicks])).toEqual([0, 0])
    await expect(editor(peer)).toHaveText('Keep the peer draft')
    await page.goBack()
    await expect(editor(page)).toHaveText('Keep the source draft')
  })

  test('persistent action buttons consume the matching engine action and its validated route', async ({ page, context }) => {
    await openApp(page)
    await ready(page)
    const away = await background(page, context)
    const data = await emit(page)
    await click(context, data, 'details')
    await expect(page).toHaveURL(`${app.origin}/#/settings?tab=config%3Abrowser-configuration`)
    expect(await page.evaluate(() => [window.pluginBodyClicks, window.pluginActionClicks])).toEqual([0, 1])
    await click(context, data)
    expect(await page.evaluate(() => [window.pluginBodyClicks, window.pluginActionClicks])).toEqual([0, 1])
    await away.close()
  })

  test('a callback-only persistent click preserves navigation performed by the plugin', async ({ page, context }) => {
    await openApp(page)
    await ready(page)
    const away = await background(page, context)
    await page.evaluate(() => { window.pluginCallbackPath = '/settings?tab=plugins' })
    const data = await emit(page, null)
    expect(data.navigate).toBe(false)
    await click(context, data)
    await expect(page).toHaveURL(`${app.origin}/#/settings?tab=plugins`)
    expect(await page.evaluate(() => window.pluginBodyClicks)).toBe(1)
    await away.close()
  })

  test('a closed notification source leaves its callback behind and routes through a live peer', async ({ page, context }) => {
    await openApp(page)
    await ready(page)
    const peer = await context.newPage()
    await openApp(peer)
    await ready(peer)
    await peer.bringToFront()
    const data = await emit(page)
    await page.close()
    await click(context, data)
    await expect(peer).toHaveURL(`${app.origin}/#/settings?tab=plugins`)
    expect(await peer.evaluate(() => [window.pluginBodyClicks, window.pluginActionClicks])).toEqual([0, 0])
  })

  test('an alert with only a callback preserves a live peer conversation after its source closes', async ({ page, context }) => {
    await openApp(page)
    await ready(page)
    const peer = await context.newPage()
    await openApp(peer, 'Keep the peer conversation', 'preview-idea')
    await ready(peer)
    await peer.bringToFront()
    const data = await emit(page, null)
    await page.close()
    await click(context, data)
    await expect(peer).toHaveURL(`${app.origin}/#/preview-idea`)
    await expect(editor(peer)).toHaveText('Keep the peer conversation')
    expect(await peer.evaluate(() => window.pluginBodyClicks)).toBe(0)
  })

  test('worker dismissal and refused delivery release callbacks in the engine registry', async ({ page, context }) => {
    await openApp(page)
    await ready(page)
    const away = await background(page, context)
    const data = await emit(page)
    await context.serviceWorkers()[0].evaluate(data => self.dismissNotificationCallbacks(data), data)
    await send(context, data.source, data.notifyId)
    expect(await page.evaluate(() => window.pluginBodyClicks)).toBe(0)
    await page.evaluate(() => { window.Notification.permission = 'denied'; window.pluginPayload = null; window.pluginDelivery = undefined })
    await emit(page)
    expect(await page.evaluate(() => window.pluginDelivery)).toBe(false)
    const notifyId = await page.evaluate(() => window.pluginPayload.notifyId)
    expect(notifyId).not.toBe(data.notifyId)
    await send(context, data.source, notifyId)
    expect(await page.evaluate(() => window.pluginBodyClicks)).toBe(0)
    await away.close()
  })

  test('same-tag publication releases the replaced callback in its original window', async ({ page, context }) => {
    await openApp(page)
    await ready(page)
    const peer = await context.newPage()
    await openApp(peer)
    await ready(peer)
    await peer.bringToFront()
    await expect.poll(() => peer.evaluate(() => Date.now() - window.pluginReadyAt), { timeout: 7000 }).toBeGreaterThan(4500)
    await Promise.all([page, peer].map(window => window.evaluate(() => { window.fixtureDisplayDelay = 100 })))
    const [first, second] = await Promise.all([emit(page), emit(peer)])
    const current = await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-notification:notification-fixture')))
    const previous = current.notifyId === first.notifyId ? second : first
    expect(current.notifyId).not.toBe(previous.notifyId)
    await send(context, previous.source, previous.notifyId)
    expect(await page.evaluate(() => window.pluginBodyClicks)).toBe(0)
    expect(await peer.evaluate(() => window.pluginBodyClicks)).toBe(0)
    await click(context, current)
    const counts = [await page.evaluate(() => window.pluginBodyClicks), await peer.evaluate(() => window.pluginBodyClicks)]
    expect(counts).toEqual(current.source === first.source ? [1, 0] : [0, 1])
  })

  test('a frozen source refuses callbacks while the worker routes through another admitted window', async ({ page, context }) => {
    await openApp(page, 'Keep the frozen source draft')
    await ready(page)
    const peer = await context.newPage()
    await openApp(peer, 'Keep the other window draft', 'preview-idea')
    await ready(peer)
    await peer.bringToFront()
    const data = await emit(page)
    const prepared = await context.serviceWorkers()[0].evaluate(async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const source = clients.find(client => new URL(client.url).hash === '#/preview-week')
      return self.requestNotificationClient(source, { type: 'HERMES_FLUSH_UPDATE', transaction: 'plugin-callback-freeze' })
    })
    expect(prepared?.ready).toBe(true)
    await expect(page.locator('#root')).toHaveJSProperty('inert', true)
    await click(context, data)
    await expect(page).toHaveURL(`${app.origin}/#/preview-week`)
    await expect(peer).toHaveURL(`${app.origin}/#/settings?tab=plugins`)
    expect(await page.evaluate(() => window.pluginBodyClicks)).toBe(0)
    await context.serviceWorkers()[0].evaluate(async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      clients.find(client => new URL(client.url).hash === '#/preview-week').postMessage({ type: 'HERMES_ABORT_UPDATE', transaction: 'plugin-callback-freeze' })
    })
    await expect(page.locator('#root')).toHaveJSProperty('inert', false)
    await send(context, data.source, data.notifyId)
    expect(await page.evaluate(() => window.pluginBodyClicks)).toBe(0)
    await expect(editor(page)).toHaveText('Keep the frozen source draft')
  })
})
