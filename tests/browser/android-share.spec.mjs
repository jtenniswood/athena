import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

let application, origin
test.beforeAll(async () => { application = await createBuiltApplication(); origin = application.origin })
test.afterAll(async () => { await application?.close() })
const composer = page => page.locator('[data-slot="composer-rich-input"]:visible').first()
const picker = page => page.getByRole('dialog', { name: 'Attach shared files' })
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 })
  await page.addInitScript(() => {
    window.shareTest = { pending: null, finished: [], reads: [], readFailure: false, finishFailures: 0 }
    const port = { onmessage: null, postMessage(raw) {
      const { id, method, payload } = JSON.parse(raw), state = window.shareTest
      let value = true
      if (method === 'hello') value = { protocol: 1, capabilities: ['share-files'], appVersion: 'test' }
      if (method === 'permission') value = 'denied'
      if (method === 'pushRegistration') value = null
      if (method === 'pendingShare') value = state.pending && { id: state.pending.id, files: state.pending.files.map(({ data, ...file }) => file) }
      if (method === 'readShareFile') {
        state.reads.push(payload)
        value = state.readFailure ? null : btoa(state.pending.files[payload.index].data.slice(payload.offset, payload.offset + 65536))
      }
      if (method === 'finishShare') {
        value = state.finishFailures-- <= 0
        if (value) { state.finished.push(payload.id); state.pending = null }
      }
      queueMicrotask(() => port.onmessage?.({ data: JSON.stringify({ id, value }) }))
    } }
    window.AthenaAndroid = port
  })
  await page.goto(`${origin}/#/preview-week`)
  await expect(composer(page)).toBeVisible({ timeout: 30000 })
})
async function share(page, files = [{ name: 'shared.txt', type: 'text/plain', data: 'shared bytes' }]) {
  await page.evaluate(files => { window.shareTest.pending = { id: 'share-test', files: files.map(file => ({ ...file, size: file.data.length })) } }, files)
  await expect(picker(page)).toBeVisible()
}

test('shared files append to the chosen existing draft without sending or replacing it', async ({ page }) => {
  await composer(page).fill('Keep my existing words')
  await share(page, [{ name: 'first.txt', type: 'text/plain', data: 'a'.repeat(70000) }, { name: 'second.pdf', type: 'application/pdf', data: '%PDF test' }])
  await picker(page).screenshot({ path: '/private/tmp/athena-android-share-picker.png' })
  await picker(page).getByRole('button', { name: 'Plan a calmer working week' }).click()
  await expect(picker(page)).toBeHidden()
  await expect(composer(page)).toHaveText('Keep my existing words')
  await expect(page.locator('[data-slot="composer-attachments"] > div')).toHaveCount(2)
  expect(await page.evaluate(() => window.shareTest.reads.map(read => read.offset))).toEqual([0, 65536, 0])
  await expect.poll(() => page.evaluate(() => window.shareTest.finished)).toEqual(['share-test'])
})

test('new chat receives the files while the previous chat retains its draft', async ({ page }) => {
  await composer(page).fill('Previous chat draft')
  await share(page)
  await picker(page).getByRole('button', { name: 'New chat' }).click()
  await expect(picker(page)).toBeHidden({ timeout: 20000 })
  await expect(page).toHaveURL(/#\/$/)
  await expect(composer(page)).toHaveText('')
  await expect(page.locator('[data-slot="composer-attachments"] > div')).toHaveCount(1)
  await page.goto(`${origin}/#/preview-week`)
  await expect(composer(page)).toHaveText('Previous chat draft')
})

test('search and cancellation leave the conversation and its draft intact', async ({ page }) => {
  await composer(page).fill('Do not change this')
  await share(page)
  await picker(page).getByRole('textbox', { name: 'Search chats' }).fill('product idea')
  await expect(picker(page).getByRole('button', { name: 'Explore a product idea' })).toBeVisible()
  await expect(picker(page).getByRole('button', { name: 'Plan a calmer working week' })).toHaveCount(0)
  await picker(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(picker(page)).toBeHidden()
  await expect(composer(page)).toHaveText('Do not change this')
  await expect(page).toHaveURL(/preview-week$/)
  expect(await page.evaluate(() => window.shareTest.reads)).toEqual([])
})

test('failed reads retain the share for retry and failed acknowledgement cannot duplicate attachments', async ({ page }) => {
  await share(page)
  await page.evaluate(() => { window.shareTest.readFailure = true })
  await picker(page).getByRole('button', { name: 'Explore a product idea' }).click()
  await expect(picker(page).getByRole('alert')).toContainText('Could not read')
  await page.evaluate(() => { window.shareTest.readFailure = false; window.shareTest.finishFailures = 1 })
  await picker(page).getByRole('button', { name: 'Explore a product idea' }).click()
  await expect(picker(page)).toBeHidden()
  await expect(page).toHaveURL(/preview-idea$/)
  await expect.poll(() => page.evaluate(() => window.shareTest.finished)).toEqual(['share-test'])
  await expect(page.locator('[data-slot="composer-attachments"] > div')).toHaveCount(1)
})

test('a chat in another profile stages files under that profile', async ({ page }) => {
  // The preview's Bot relationship chats are hidden from ordinary history; expose a regular profile chat.
  await page.route(/\/api\/profiles\/sessions\?/, async route => {
    const response = await route.fetch(), body = await response.json()
    body.sessions.push({ ...body.sessions[0], id: 'preview-research', profile: 'research', title: 'Research conversation' })
    body.total = body.sessions.length
    await route.fulfill({ response, json: body })
  })
  const uploads = []
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/chat/file-upload') uploads.push(new URL(request.url()).searchParams.get('profile'))
  })
  await share(page)
  await picker(page).getByRole('textbox', { name: 'Search chats' }).fill('research')
  await picker(page).getByRole('button', { name: 'Research conversation research' }).click()
  await expect(picker(page)).toBeHidden({ timeout: 20000 })
  await expect(page).toHaveURL(/preview-research/)
  await expect(page.locator('[data-slot="composer-attachments"] > div')).toHaveCount(1)
  expect(uploads).toEqual(['research'])
})

test('a selection change during staging cannot put a shared file into another chat', async ({ page }) => {
  await share(page)
  await page.route('**/api/chat/file-upload*', async route => {
    await page.evaluate(() => { window.location.hash = '/preview-idea' })
    await expect(page.locator('[data-browser-conversation-id="preview-idea"]')).toBeVisible()
    await route.continue()
  })
  await picker(page).getByRole('button', { name: 'Plan a calmer working week' }).click()
  await expect(picker(page).getByRole('alert')).toContainText('selected chat changed')
  await picker(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('[data-slot="composer-attachments"] > div')).toHaveCount(0)
})

test('a shared image uses the image attachment path and leaves the message unsent', async ({ page }) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHZkAAAAASUVORK5CYII=', 'base64').toString('binary')
  await share(page, [{ name: 'shared.png', type: 'image/png', data: png }])
  await picker(page).getByRole('button', { name: 'Plan a calmer working week' }).click()
  await expect(picker(page)).toBeHidden()
  await expect(page.locator('[data-slot="composer-attachments"] > div')).toHaveCount(1)
  await expect(page.locator('[data-slot="composer-attachments"] img')).toBeVisible()
  await expect(composer(page)).toHaveText('')
})
