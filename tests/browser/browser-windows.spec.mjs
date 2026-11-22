import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

let application, origin
test.beforeAll(async () => { application = await createBuiltApplication(); origin = application.origin })
test.afterAll(async () => { await application?.close() })
const composer = page => page.locator('[data-slot="composer-rich-input"]:visible').first()
test.beforeEach(async ({ page }) => {
  await page.goto(`${origin}/#/preview-week`)
  await expect(composer(page)).toBeVisible({ timeout: 30000 })
  await composer(page).fill('Retain the original tab draft')
})

async function installCommand(page, command, args) {
  await page.evaluate(({ command, args }) => {
    const button = document.createElement('button')
    button.textContent = 'Open test window'
    button.onclick = () => {
      window.windowResult = null
      Promise.resolve(window.hermesDesktop[command](...args)).then(
        result => { window.windowResult = result },
        error => { window.windowResult = { ok: false, error: error.message, notificationId: error.notificationId } }
      )
    }
    document.body.prepend(button)
  }, { command, args })
}

async function openCommand(page, command, args) {
  await installCommand(page, command, args)
  const opened = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Open test window', exact: true }).click()
  return opened
}

test('a detached session window acknowledges opening and preserves its original tab', async ({ page }) => {
  await page.evaluate(() => sessionStorage.setItem('parent-tab-only', 'sentinel'))
  const popup = await openCommand(page, 'openSessionWindow', ['preview-idea'])
  try {
    await expect(popup).toHaveURL(/#\/preview-idea$/)
    await expect(composer(popup)).toBeVisible({ timeout: 30000 })
    expect(await popup.evaluate(() => window.opener)).toBeNull()
    expect(await popup.evaluate(() => sessionStorage.getItem('parent-tab-only'))).toBeNull()
    await expect.poll(() => page.evaluate(() => window.windowResult)).toEqual({ ok: true })
    expect(new URL(popup.url()).searchParams.has('hello')).toBe(false)
    await expect(page).toHaveURL(`${origin}/#/preview-week`)
    await expect(composer(page)).toHaveText('Retain the original tab draft')
  } finally { await popup.close() }
})

test('a new app window keeps its explicit profile through first send and later reloads', async ({ page }) => {
  const popup = await openCommand(page, 'openWindow', [{ connectionId: 'web-single', profile: 'research' }])
  try {
    await expect(composer(popup)).toBeVisible({ timeout: 30000 })
    await expect.poll(() => page.evaluate(() => window.windowResult)).toEqual({ ok: true })
    expect(new URL(popup.url()).searchParams.get('profile')).toBe('research')
    await composer(popup).fill('A question from the routed window')
    await composer(popup).press('Enter')
    await expect(popup.locator('[data-slot="aui_user-message-root"]').last()).toContainText('A question from the routed window')
    expect(application.gateway.controls.calls.some(call => call.method === 'session.create' &&
      (call.params?.profile === 'research' || call.profile === 'research'))).toBe(true)
    await popup.getByRole('button', { name: 'Filters', exact: true }).click()
    await popup.getByRole('menuitem', { name: 'Profiles', exact: true }).hover()
    await popup.getByRole('menuitemradio', { name: 'Separate', exact: true }).click()
    await popup.keyboard.press('Escape')
    await popup.keyboard.press('Escape')
    await popup.locator('[data-profile-key="writer"]').click()
    await expect.poll(() => new URL(popup.url()).searchParams.get('profile')).toBe('writer')
    await popup.reload()
    await expect(composer(popup)).toBeVisible({ timeout: 30000 })
    expect((await popup.evaluate(() => window.hermesDesktop.getConnection())).profile).toBe('writer')
    await expect(composer(page)).toHaveText('Retain the original tab draft')
  } finally { await popup.close() }
})

test('session watch windows retain the requested profile and spectator route', async ({ page }) => {
  const popup = await openCommand(page, 'openSessionWindow', ['preview-research', { connectionId: 'web-single', profile: 'research', watch: true }])
  try {
    await expect(popup.getByText('I can help you investigate a question, compare approaches, and organize your findings. What are you curious about?', { exact: true })).toBeVisible({ timeout: 30000 })
    await expect.poll(() => page.evaluate(() => window.windowResult)).toEqual({ ok: true })
    const url = new URL(popup.url())
    expect(url.searchParams.get('profile')).toBe('research')
    expect(url.searchParams.get('win')).toBe('secondary')
    expect(url.searchParams.get('watch')).toBe('1')
    expect(url.hash).toBe('#/preview-research?profile=research')
    expect((await popup.evaluate(() => window.hermesDesktop.getConnection())).profile).toBe('research')
    await expect(composer(page)).toHaveText('Retain the original tab draft')
  } finally { await popup.close() }
})

test('invalid routes and a blocked popup cannot report a successful window', async ({ page }) => {
  const invalid = await page.evaluate(async () => {
    let opens = 0
    window.open = () => { opens++; return null }
    const bridge = window.hermesDesktop
    const empty = await bridge.openSessionWindow('   ')
    const rejected = []
    for (const command of [() => bridge.openWindow({ connectionId: 'another-gateway', profile: 'research' }),
      () => bridge.openSessionWindow('preview-idea', { connectionId: 'another-gateway' })]) {
      try { await command() } catch (error) { rejected.push(error.message) }
    }
    return { opens, empty, rejected }
  })
  expect(invalid.opens).toBe(0)
  expect(invalid.empty).toEqual({ ok: false, error: 'invalid_session_id' })
  expect(invalid.rejected).toHaveLength(2)
  expect(invalid.rejected.every(message => message.includes('configured gateway'))).toBe(true)
  await installCommand(page, 'openWindow', [])
  await page.getByRole('button', { name: 'Open test window', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.windowResult), { timeout: 8000 }).toMatchObject({ ok: false, error: expect.stringContaining('did not open'), notificationId: expect.stringMatching(/^webapp-window-blocked:/) })
  await expect(composer(page)).toHaveText('Retain the original tab draft')
})
