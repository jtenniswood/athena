import { test, expect } from '@playwright/test'
import { preview } from 'vite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPreviewGateway } from '../../scripts/preview/gateway.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
let gateway, server, origin, temporary
const previous = new Map()
test.beforeAll(async () => {
  temporary = mkdtempSync(path.join(tmpdir(), 'athena-composer-keyboard-'))
  gateway = createPreviewGateway({ delay: 1 })
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve))
  const environment = {
    HERMES_GATEWAY_URL: `http://127.0.0.1:${gateway.server.address().port}`,
    HERMES_HOME: temporary,
    HERMES_PREFERENCES_DIR: path.join(temporary, 'preferences')
  }
  for (const [key, value] of Object.entries(environment)) { previous.set(key, process.env[key]); process.env[key] = value }
  server = await preview({ root: path.join(root, 'apps/web-desktop'), logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } })
  origin = `http://127.0.0.1:${server.httpServer.address().port}`
})
test.afterAll(async () => {
  await server?.close()
  await gateway?.close()
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  if (temporary) rmSync(temporary, { recursive: true, force: true })
})

const composer = page => page.locator('[data-slot="composer-rich-input"]:visible').first()
test.beforeEach(async ({ page }) => {
  await page.goto(`${origin}/#/preview-week`)
  await expect(composer(page)).toBeVisible({ timeout: 30000 })
})

test('composer line breaks preserve undo, draft persistence and ordinary submission', async ({ page }) => {
  const editor = composer(page)
  await editor.fill('First line')
  await editor.press('End')
  await editor.press('Shift+Enter')
  const modifier = await page.evaluate(() => /Mac/i.test(navigator.platform) ? 'Meta' : 'Control')
  await editor.press(`${modifier}+z`)
  await expect.poll(() => editor.innerText()).toBe('First line')
  await editor.press('Shift+Enter')
  await editor.pressSequentially('Persisted second line')
  await expect.poll(() => editor.innerText()).toBe('First line\nPersisted second line')
  await page.reload()
  await expect.poll(() => composer(page).innerText()).toBe('First line\nPersisted second line')
  await composer(page).press('Enter')
  await expect(page.locator('[data-slot="aui_user-message-root"]').last()).toContainText('Persisted second line')
  await expect.poll(() => composer(page).innerText()).toBe('')
})

test('composer line breaks respect IME commits, selection and unrelated editors', async ({ page }) => {
  const editor = composer(page)
  await editor.fill('Keep this text')
  const ime = await editor.evaluate(node => {
    node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const preedit = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, isComposing: true, bubbles: true, cancelable: true })
    node.dispatchEvent(preedit)
    node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    const commit = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, keyCode: 229, bubbles: true, cancelable: true })
    node.dispatchEvent(commit)
    return { preeditPrevented: preedit.defaultPrevented, commitPrevented: commit.defaultPrevented, text: node.innerText }
  })
  expect(ime).toEqual({ preeditPrevented: false, commitPrevented: false, text: 'Keep this text' })
  const unrelated = await page.evaluate(() => {
    const input = document.createElement('textarea')
    document.body.append(input)
    const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })
    input.dispatchEvent(event)
    input.remove()
    return event.defaultPrevented
  })
  expect(unrelated).toBe(false)
  await editor.fill('Before selected after')
  await editor.evaluate(node => {
    const range = document.createRange(), text = node.firstChild
    range.setStart(text, 7); range.setEnd(text, 15)
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
  })
  await editor.press('Shift+Enter')
  await expect.poll(async () => (await editor.innerText()).replaceAll('\u00a0', ' ')).toBe('Before \n after')
})

test('accepted sends position their real mounted renderer transcript', async ({ page }) => {
  for (const [text, fresh] of [['Position this accepted prompt', false], ['First prompt in a fresh chat', true]]) {
    if (fresh) await page.getByRole('button', { name: 'New session', exact: true }).click()
    const editor = composer(page)
    await editor.fill(text)
    await editor.press('Enter')
    const prompt = page.locator('[data-slot="aui_user-message-root"]').last()
    await expect(prompt).toContainText(text)
    await expect.poll(() => prompt.evaluate(node => node.closest('[data-slot="aui_turn-pair"]').style.minHeight)).not.toBe('')
    // The first turn starts at scrollTop zero; it cannot scroll above its natural top.
    await expect.poll(() => prompt.evaluate(node => {
      const turn = node.closest('[data-slot="aui_turn-pair"]')
      const viewport = node.closest('[data-slot="aui_thread-viewport"]')
      const scale = viewport.getBoundingClientRect().height / viewport.offsetHeight
      return (turn.getBoundingClientRect().top - viewport.getBoundingClientRect().top) / scale
    })).toBeCloseTo(fresh ? 0 : 12, 0)
  }
})
