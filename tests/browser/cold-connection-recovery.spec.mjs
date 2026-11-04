import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

test.use({ serviceWorkers: 'block' })
let app
test.beforeAll(async () => { app = await createBuiltApplication() })
test.afterAll(async () => { await app?.close() })
test.beforeEach(async ({ page }) => { await page.route('**/api/athena/preferences', route => route.abort()) })
const editor = page => page.locator('[data-slot="composer-rich-input"]:visible').first()

async function expireCookie(page) {
  let startup = true
  await page.route('**/api/status', route => route.fulfill({ json: { auth_required: true, auth_providers: ['basic'] } }))
  await page.route('**/api/auth/me', route => {
    const allowed = startup
    startup = false
    return route.fulfill({ status: allowed ? 200 : 401, json: allowed ? { user_id: 'preview-user', provider: 'basic' } : {} })
  })
  await page.route('**/api/auth/ws-ticket', route => route.fulfill({ status: 401, body: 'Synthetic expired session' }))
}

async function openRecovery(page, route = '/#/preview-week') {
  await expireCookie(page)
  await page.goto(app.origin + route)
  await recoverySettings(page)
}

async function recoverySettings(page) {
  await page.getByRole('button', { name: 'Gateway settings', exact: true }).click()
  await page.getByRole('combobox', { name: 'Sign-in method' }).click()
  await page.getByRole('option', { name: 'Session token', exact: true }).click()
}

async function applyToken(page) {
  await page.evaluate(() => {
    const apply = window.hermesDesktop.applyConnectionConfig
    window.coldApplyCompleted = false
    window.hermesDesktop.applyConnectionConfig = async (...args) => {
      try { return await apply(...args) }
      finally { window.coldApplyCompleted = true }
    }
  })
  await page.getByLabel('Session token', { exact: true }).fill('synthetic-cold-recovery-token')
  await page.getByRole('button', { name: 'Save and reconnect', exact: true }).click()
}

async function recovered(page, sessionId) {
  await page.waitForFunction(() => window.coldApplyCompleted)
  await expect(page.locator('#root')).toHaveJSProperty('inert', false)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(editor(page)).toBeVisible()
  if (sessionId) await expect(page.locator('[data-browser-conversation-id]')).toHaveAttribute('data-browser-conversation-id', sessionId)
}

async function holdPrimaryDial(page) {
  await page.evaluate(() => {
    const mint = window.hermesDesktop.getGatewayWsUrlFor
    let first = true
    window.hermesDesktop.getGatewayWsUrlFor = async scope => {
      const result = await mint(scope)
      if (first && (!scope.profile || scope.profile === 'default')) {
        first = false
        await new Promise(resolve => { window.releaseColdDial = resolve })
      }
      return result
    }
  })
  return {
    entered: () => page.waitForFunction(() => Boolean(window.releaseColdDial)),
    release: () => page.evaluate(() => window.releaseColdDial?.())
  }
}

test('cold token recovery resumes the unowned chat URL without another sidebar click', async ({ page }) => {
  await openRecovery(page)
  await applyToken(page)
  await recovered(page, 'preview-week')
  await expect(page).toHaveURL(app.origin + '/#/preview-week')
  await expect(page.getByText('A little more room to think', { exact: true })).toBeVisible()
})

test('cold recovery retains the explicit Research chat owner', async ({ page }) => {
  await openRecovery(page, '/?profile=research#/preview-research?profile=research')
  await applyToken(page)
  await recovered(page, 'preview-research')
  await expect(page).toHaveURL(app.origin + '/?profile=research#/preview-research?profile=research')
  await expect(page.getByText('I can help you investigate a question, compare approaches, and organize your findings. What are you curious about?', { exact: true })).toBeVisible()
})

test('a newer owned URL wins while cold recovery is dialing', async ({ page }) => {
  await openRecovery(page)
  const held = await holdPrimaryDial(page)
  try {
    await applyToken(page)
    await held.entered()
    await page.evaluate(() => { location.hash = '/preview-research?profile=research' })
  } finally { await held.release() }
  await recovered(page, 'preview-research')
  expect(new URL(page.url()).hash).toBe('#/preview-research?profile=research')
})

test('a newer new-chat route is not replaced by the cold recovery URL', async ({ page }) => {
  await openRecovery(page)
  const held = await holdPrimaryDial(page)
  const before = app.gateway.controls.calls.length
  try {
    await applyToken(page)
    await held.entered()
    await page.evaluate(() => { location.hash = '/' })
  } finally { await held.release() }
  await recovered(page)
  expect(new URL(page.url()).hash).toBe('#/')
  expect(app.gateway.controls.calls.slice(before).filter(call => call.method === 'session.resume' && call.params.session_id === 'preview-week')).toEqual([])
  await expect(editor(page)).toBeEmpty()
})

test('cold recovery restores the saved draft for its routed conversation', async ({ page }) => {
  await page.goto(app.origin + '/?token=synthetic-initial-token#/preview-week')
  await expect(editor(page)).toBeVisible()
  await editor(page).fill('Keep this draft through expired-cookie recovery')
  await page.evaluate(() => window.hermesDesktop.applyConnectionConfig({ mode: 'remote', remoteAuthMode: 'oauth', remoteToken: '' }))
  await expireCookie(page)
  await page.reload()
  await recoverySettings(page)
  await applyToken(page)
  await recovered(page, 'preview-week')
  await expect(editor(page)).toHaveText('Keep this draft through expired-cookie recovery')
})
