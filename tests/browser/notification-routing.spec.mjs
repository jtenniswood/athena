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

test('Android notification routes reveal the related chat on cold and warm opens', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 800 } })
  try {
    const page = await context.newPage()
    const first = '#/preview-research?profile=research&androidNotification=1'
    const second = '#/preview-writer?profile=writer&androidNotification=1'
    await page.goto(origin + '/' + first)
    await expect(page.getByText('I can help you investigate a question', { exact: false })).toBeVisible()
    await composer(page).fill('Keep this draft on Android')
    await page.getByRole('button', { name: 'Back to chat history', exact: true }).click()
    await expect(composer(page)).toBeHidden()
    await page.evaluate(() => window.dispatchEvent(new Event('athena:open-notification')))
    await expect(composer(page)).toHaveText('Keep this draft on Android')
    await page.getByRole('button', { name: 'Back to chat history', exact: true }).click()
    await expect(composer(page)).toBeHidden()
    await page.evaluate(hash => { window.location.hash = hash }, second)
    await expect(page.getByText('Bring a rough outline or a first draft', { exact: false })).toBeVisible()
    await page.evaluate(hash => { window.location.hash = hash }, first)
    await expect(composer(page)).toHaveText('Keep this draft on Android')
  } finally { await context.close() }
})

test('the live profile can refuse a stale worker client URL without losing its draft', async ({ page }) => {
  const original = page.url()
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Profiles', exact: true }).hover()
  await page.getByRole('menuitemradio', { name: 'Separate', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
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

test('a prepared update blocks portal menus until the worker aborts', async ({ page }) => {
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  const rename = page.locator('[role="menuitem"]').filter({ hasText: /^Rename/ })
  await expect(rename).toBeVisible()
  expect(await rename.evaluate(node => document.getElementById('root').contains(node))).toBe(false)
  try {
    expect((await sendFromWorker(page, { type: 'HERMES_FLUSH_UPDATE', transaction: 'portal-check' })).ready).toBe(true)
    await expect(page.locator('body')).toHaveJSProperty('inert', true)
    await expect(rename.click({ timeout: 500 })).rejects.toThrow()
    await expect(page.locator('[role="dialog"]')).toHaveCount(0)
  } finally { await sendFromWorker(page, { type: 'HERMES_ABORT_UPDATE', transaction: 'portal-check' }, false) }
  await expect(page.locator('body')).toHaveJSProperty('inert', false)
  if (!await rename.isVisible()) await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await rename.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(composer(page)).toHaveText('Keep this notification-tab draft')
})

test('pending sign-out refuses PWA preparation and retains its draft after logout fails', async ({ page }) => {
  await page.evaluate(() => { location.hash = '/settings?tab=gateway' })
  let finishLogout
  await page.route('**/auth/logout', async route => {
    await new Promise(resolve => { finishLogout = resolve })
    await route.fulfill({ status: 503, body: 'Synthetic logout failure' })
  })
  try {
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect.poll(() => typeof finishLogout).toBe('function')
    await expect(page.locator('#root')).toHaveJSProperty('inert', true)
    expect((await sendFromWorker(page, { type: 'HERMES_FLUSH_UPDATE', transaction: 'sign-out-pending' })).ready).toBe(false)
    await sendFromWorker(page, { type: 'HERMES_ABORT_UPDATE', transaction: 'sign-out-pending' }, false)
    await expect(page.locator('#root')).toHaveJSProperty('inert', true)
    expect(await route(page, page.url())).toEqual({ ready: false })
  } finally { finishLogout?.() }
  await expect(page.getByRole('status').filter({ hasText: 'Sign-out failed' })).toBeVisible()
  await expect(page.locator('#root')).toHaveJSProperty('inert', false)
  expect(await page.evaluate(() => window.notificationDocument)).toBe('Retain this document')
  expect((await sendFromWorker(page, { type: 'HERMES_FLUSH_UPDATE', transaction: 'after-sign-out-failure' })).ready).toBe(true)
  await sendFromWorker(page, { type: 'HERMES_ABORT_UPDATE', transaction: 'after-sign-out-failure' }, false)
  await expect(page.locator('#root')).toHaveJSProperty('inert', false)
  await page.getByRole('button', { name: 'Close settings', exact: true }).click()
  await expect(composer(page)).toHaveText('Keep this notification-tab draft')
})

async function offerRemotePreferences(page) {
  const saved = await (await page.request.get(`${origin}/api/athena/preferences`)).json()
  const theme = saved.values['hermes-desktop-theme-v2'] === 'light' ? 'dark' : 'light'
  const changed = await page.request.patch(`${origin}/api/athena/preferences`, {
    headers: { Origin: origin },
    data: { version: 1, accountId: saved.accountId, seed: false, changes: { 'hermes-desktop-theme-v2': theme } }
  })
  expect(changed.ok(), `Preference patch status: ${changed.status()}`).toBe(true)
  await page.evaluate(() => { window.location.hash = '/settings?tab=config%3Abrowser-configuration'; window.dispatchEvent(new Event('focus')) })
  await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toBeVisible()
  return theme
}

test('a postponed update cannot unlock a pending preference application', async ({ page }) => {
  await offerRemotePreferences(page)
  let pending
  await page.route('**/api/athena/preferences', async route => {
    if (!pending && route.request().method() === 'GET' && await page.locator('#root').evaluate(root => root.inert)) {
      await new Promise(resolve => { pending = resolve })
      await route.fulfill({ status: 503, body: 'Synthetic preference application failure' })
    } else await route.continue()
  })
  try {
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
    await expect.poll(() => typeof pending).toBe('function')
    await expect(page.locator('#root')).toHaveJSProperty('inert', true)
    expect((await sendFromWorker(page, { type: 'HERMES_FLUSH_UPDATE', transaction: 'preferences-pending' })).ready).toBe(false)
    expect(await page.locator('#root').evaluate(root => root.inert)).toBe(true)
  } finally { pending?.() }
  await expect(page.getByRole('alert')).toContainText('Settings sync is unavailable')
  await expect(page.locator('#root')).toHaveJSProperty('inert', false)
  expect(await route(page, page.url())).toEqual({ ready: true })
  const original = new URL(page.url()); original.hash = '/preview-research'
  expect(await route(page, original.href)).toEqual({ ready: true })
  await expect(composer(page)).toHaveText('Keep this notification-tab draft')
})


test('a prepared update refuses preference application until abort and preserves its draft on reload', async ({ page }) => {
  const theme = await offerRemotePreferences(page)
  const machineRequests = []
  await page.route('**/api/ui-preferences', route => {
    machineRequests.push(route.request().method())
    return route.fulfill({ json: { exists: true, generation: 'another-machine-store', revision: 100,
      values: { 'hermes-desktop-theme-v2': theme === 'dark' ? 'light' : 'dark' } } })
  })
  let requests = 0
  await page.route('**/api/athena/preferences', async request => { requests++; await request.continue() })
  expect((await sendFromWorker(page, { type: 'HERMES_FLUSH_UPDATE', transaction: 'update-first' })).ready).toBe(true)
  // A stale presenter command can invoke an action even while ordinary input is inert.
  await page.getByRole('button', { name: 'Apply changes', exact: true }).evaluate(button => button.click())
  expect(requests).toBe(0)
  expect(await page.locator('#root').evaluate(root => root.inert)).toBe(true)
  await sendFromWorker(page, { type: 'HERMES_ABORT_UPDATE', transaction: 'update-first' }, false)
  await expect(page.locator('#root')).toHaveJSProperty('inert', false)
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  ])
  await expect(page.getByRole('heading', { name: 'Sync across devices', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.notificationDocument)).toBeUndefined()
  expect(await page.evaluate(() => localStorage.getItem('hermes-desktop-theme-v2'))).toBe(theme)
  expect(machineRequests).toEqual([])
  await page.evaluate(() => { window.location.hash = '/preview-research' })
  await expect(composer(page)).toHaveText('Keep this notification-tab draft')
})
