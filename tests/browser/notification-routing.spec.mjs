import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

let application, origin
test.beforeAll(async () => { application = await createBuiltApplication(); origin = application.origin })
test.afterAll(async () => { await application?.close() })
const composer = page => page.locator('[data-slot="composer-rich-input"]:visible').first()
test.beforeEach(async ({ page }) => {
  await page.goto(`${origin}/?profile=research#/preview-research`)
  await expect(composer(page)).toBeVisible({ timeout: 30000 })
  await composer(page).fill('Keep this notification-tab draft')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await page.evaluate(() => { window.notificationDocument = 'Retain this document' })
})

async function sendFromWorker(page, message, reply = true) {
  // Use the production worker's real client and transferred ports. OS notification
  // permission and focus activation are covered separately by the worker policy tests.
  const worker = page.context().serviceWorkers()[0]
  return worker.evaluate(async ({ message, reply }) => {
    const [client] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (!reply) { client.postMessage(message); return }
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel()
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Notification route did not reply')) }, 3000)
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data) }
      client.postMessage(message, [channel.port2])
    })
  }, { message, reply })
}
async function route(page, url) {
  return page.context().serviceWorkers()[0].evaluate(async url => {
    const [client] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    return { ready: await self.routeNotificationClient(client, url) }
  }, url)
}

test('notification hash routes retain the live document and its original draft', async ({ page }) => {
  const original = page.url(), target = new URL(original)
  target.hash = '/settings'
  expect(await route(page, target.href)).toEqual({ ready: true })
  await expect(page).toHaveURL(target.href)
  expect(await page.evaluate(() => window.notificationDocument)).toBe('Retain this document')
  expect(await route(page, original)).toEqual({ ready: true })
  await expect(composer(page)).toHaveText('Keep this notification-tab draft')
})

test('the live profile can refuse a stale worker client URL without losing its draft', async ({ page }) => {
  const original = page.url()
  await page.locator('[data-profile-key="writer"]').click()
  await expect.poll(() => new URL(page.url()).searchParams.get('profile')).toBe('writer')
  await composer(page).fill('Keep the newly selected profile draft')
  const current = page.url()
  for (const url of [original, `${origin}/other-app/#/chat`, 'https://elsewhere.example.test/#/chat']) {
    expect(await route(page, url)).toEqual({ ready: false })
    await expect(page).toHaveURL(current)
  }
  expect(await page.evaluate(() => window.notificationDocument)).toBe('Retain this document')
  await expect(composer(page)).toHaveText('Keep the newly selected profile draft')
})

test('notification routes yield to a prepared update and work again after abort', async ({ page }) => {
  const target = new URL(page.url()); target.hash = '/settings'
  expect((await sendFromWorker(page, { type: 'HERMES_FLUSH_UPDATE', transaction: 'notification-check' })).ready).toBe(true)
  await expect(page.locator('#root')).toHaveJSProperty('inert', true)
  expect(await route(page, target.href)).toEqual({ ready: false })
  expect(new URL(page.url()).hash).toBe('#/preview-research')
  await sendFromWorker(page, { type: 'HERMES_ABORT_UPDATE', transaction: 'notification-check' }, false)
  await expect(page.locator('#root')).toHaveJSProperty('inert', false)
  expect(await route(page, target.href)).toEqual({ ready: true })
  expect(await page.evaluate(() => window.notificationDocument)).toBe('Retain this document')
})
