import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

let application
test.beforeAll(async () => { application = await createBuiltApplication() })
test.afterAll(async () => { await application?.close() })

test('Update title uses later conversation content and preserves selection and drafts', async ({ page }) => {
  const calls = []
  let finish
  await page.routeWebSocket(/\/api\/ws/, socket => {
    const server = socket.connectToServer()
    server.onMessage(message => socket.send(message))
    socket.onMessage(message => {
      const frame = JSON.parse(String(message))
      if (frame.method === 'llm.oneshot') {
        calls.push(frame.params)
        finish = () => socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { text: 'Protecting weekly focus time' } }))
        return
      }
      server.send(message)
    })
  })
  await page.goto(`${application.origin}/#/preview-week`)
  const editor = page.locator('[data-slot="composer-rich-input"]:visible').first()
  await expect(editor).toBeVisible({ timeout: 30000 })
  await editor.fill('Keep this unsent draft')
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Update title', exact: true }).click()
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0].input).toContain('user: Help me make a thoughtful plan.')
  expect(calls[0].input).toContain('assistant:')
  expect(calls[0].input).toContain('Friday:')
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Updating title…', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(editor).toHaveText('Keep this unsent draft')
  await page.getByRole('button', { name: 'Explore a product idea', exact: true }).click()
  finish()
  await expect.poll(() => application.gateway.sessions.get('preview-week').title).toBe('Protecting weekly focus time')
  await expect(page.getByRole('button', { name: 'Protecting weekly focus time', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/preview-idea/)
  await page.getByRole('button', { name: 'Protecting weekly focus time', exact: true }).click()
  await expect(editor).toHaveText('Keep this unsent draft')
})

test('sidebar Update title failure keeps the existing title and current conversation', async ({ page }) => {
  const original = application.gateway.sessions.get('preview-idea').title
  await page.routeWebSocket(/\/api\/ws/, socket => {
    const server = socket.connectToServer()
    server.onMessage(message => socket.send(message))
    socket.onMessage(message => {
      const frame = JSON.parse(String(message))
      if (frame.method === 'llm.oneshot') return socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32000, message: 'Generation unavailable' } }))
      server.send(message)
    })
  })
  await page.goto(`${application.origin}/#/preview-week`)
  const editor = page.locator('[data-slot="composer-rich-input"]:visible').first()
  await expect(editor).toBeVisible({ timeout: 30000 })
  await editor.fill('A draft to keep')
  await page.getByRole('button', { name: 'Explore a product idea', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Update title', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not update title')
  expect(application.gateway.sessions.get('preview-idea').title).toBe(original)
  await expect(page).toHaveURL(/preview-week/)
  await expect(editor).toHaveText('A draft to keep')
})

for (const platform of ['MacIntel', 'Linux x86_64']) {
  test(`Update title shortcut shares menu behavior and protects editing on ${platform}`, async ({ page }) => {
    await page.addInitScript(platform => Object.defineProperty(navigator, 'platform', { value: platform }), platform)
    const shortcut = `${platform === 'MacIntel' ? 'Meta' : 'Control'}+Shift+X`
    const hint = platform === 'MacIntel' ? '⇧⌘X' : 'Ctrl+Shift+X'
    const calls = []
    let finish
    await page.routeWebSocket(/\/api\/ws/, socket => {
      const server = socket.connectToServer()
      server.onMessage(message => socket.send(message))
      socket.onMessage(message => {
        const frame = JSON.parse(String(message))
        if (frame.method === 'llm.oneshot') {
          calls.push(frame.params)
          finish = () => socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { text: 'Title: Protect weekly focus time!' } }))
          return
        }
        server.send(message)
      })
    })
    await page.goto(`${application.origin}/#/preview-week`)
    const editor = page.locator('[data-slot="composer-rich-input"]:visible').first()
    await expect(editor).toBeVisible({ timeout: 30000 })
    await editor.fill('Keep this shortcut draft')
    await editor.press(shortcut)
    const main = page.getByRole('main', { name: 'Conversation and workspace' })
    const trigger = page.getByRole('button', { name: 'Chat actions', exact: true })
    await trigger.click()
    await expect(page.getByRole('menuitem', { name: 'Update title', exact: true }).locator('.browser-session-shortcut')).toHaveText(hint)
    await page.keyboard.press(shortcut)
    await page.keyboard.press('Escape')
    await trigger.click()
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
    const rename = page.getByRole('dialog', { name: 'Rename session', exact: true })
    await expect(rename).toBeVisible()
    await page.keyboard.press(shortcut)
    await rename.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(rename).toBeHidden()
    await main.focus()
    await page.keyboard.press(shortcut)
    await expect.poll(() => calls.length).toBe(1)
    expect(calls[0].instructions).toContain('3 to 7 words, sentence case')
    expect(calls[0].input).toContain('Friday:')
    await page.keyboard.press(shortcut)
    await trigger.click()
    await expect(page.getByRole('menuitem', { name: 'Updating title…', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    expect(calls).toHaveLength(1)
    finish()
    await expect.poll(() => application.gateway.sessions.get('preview-week').title).toBe('Protect weekly focus time')
    await expect(editor).toHaveText('Keep this shortcut draft')
    await expect(page).toHaveURL(/preview-week/)
    await page.getByRole('button', { name: 'Protect weekly focus time', exact: true }).click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: /Update title/ }).locator('.browser-session-shortcut')).toHaveText(hint)
    await page.keyboard.press('Escape')
  })
}
