import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

let application, origin
test.beforeAll(async () => { application = await createBuiltApplication(); origin = application.origin })
test.afterAll(async () => { await application?.close() })

const composer = page => page.locator('[data-slot="composer-rich-input"]:visible').first()
test.beforeEach(async ({ page, isMobile }) => {
  await page.goto(`${origin}/#/preview-week`)
  if (isMobile) await page.getByRole('button', { name: 'Plan a calmer working week', exact: true }).tap()
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
    if (fresh) await page.getByRole('button', { name: 'New session in Hermes', exact: true }).click()
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

test.describe('Android keyboard dictation', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', "Uses Chromium's native IME composition protocol")
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 393, height: 700 } })

  for (const [scenario, initialText] of [
    ['tapping Send commits keyboard dictation in an empty draft', ''],
    ['tapping Send commits keyboard dictation after typing', 'Typed first. ']
  ]) {
    test(scenario, async ({ page }) => {
      const editor = composer(page)
      const send = page.locator('[data-browser-send-action]:visible')
      if (initialText) {
        await editor.fill(initialText)
        await editor.press('End')
        await expect(send).toBeEnabled()
      } else {
        await editor.tap()
      }

      const ime = await page.context().newCDPSession(page)
      const dictated = 'Send every dictated word'
      await ime.send('Input.imeSetComposition', {
        text: dictated, selectionStart: dictated.length, selectionEnd: dictated.length
      })
      const message = initialText + dictated
      await expect(editor).toHaveText(message)

      await editor.dispatchEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true })
      await expect(editor).toHaveText(message)

      await expect(send).toBeEnabled({ timeout: 3000 })
      await send.tap()
      const prompt = page.locator('[data-slot="aui_user-message-root"]').filter({ hasText: message })
      await expect(prompt).toHaveCount(1, { timeout: 3000 })
      await expect(editor).toBeEmpty()
    })
  }
})
