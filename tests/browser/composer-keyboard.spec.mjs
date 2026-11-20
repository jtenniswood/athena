import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

let application, origin
test.beforeAll(async () => { application = await createBuiltApplication(); origin = application.origin })
test.afterAll(async () => { await application?.close() })

const composer = page => page.locator('[data-slot="composer-rich-input"]:visible').first()
async function openComposer(page, isMobile = false) {
  await page.goto(`${origin}/#/preview-week`)
  if (isMobile) await page.getByRole('button', { name: 'Plan a calmer working week', exact: true }).tap()
  await expect(composer(page)).toBeVisible({ timeout: 30000 })
}

test('composer line breaks preserve undo, draft persistence and ordinary submission', async ({ page }) => {
  await openComposer(page)
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
  await openComposer(page)
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
  await openComposer(page)
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
      await openComposer(page, true)
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

const followup = 'Try a shorter version of the plan and verify it still covers Friday.'

async function interceptPredictions(page, isMobile = false) {
  const requests = []
  await page.routeWebSocket(/\/api\/ws/, socket => {
    const server = socket.connectToServer()
    server.onMessage(message => socket.send(message))
    socket.onMessage(message => {
      const frame = JSON.parse(String(message))
      if (frame.method === 'llm.oneshot' && frame.params.max_tokens === 160 &&
          frame.params.instructions?.startsWith('Suggest one useful next prompt')) {
        requests.push({
          params: frame.params,
          resolve: text => socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { text } }))
        })
        return
      }
      server.send(message)
    })
  })
  await openComposer(page, isMobile)
  return requests
}

test('a completed reply suggests an editable follow-up that Tab accepts and Enter sends', async ({ page }) => {
  const requests = await interceptPredictions(page)
  const editor = composer(page)
  const userMessages = page.locator('[data-slot="aui_user-message-root"]')
  const previousPrompt = 'Rework the weekly plan around a Friday deadline.'
  await editor.fill(previousPrompt)
  await editor.press('Enter')
  await expect.poll(() => requests.length).toBe(1)
  const context = JSON.parse(requests[0].params.input)
  expect(context).toContainEqual({ role: 'user', text: previousPrompt })
  expect(context.at(-1)).toMatchObject({ role: 'assistant', text: expect.stringContaining('synthetic response') })
  requests[0].resolve(followup)

  await expect(editor).toHaveAttribute('data-placeholder', followup)
  await expect(editor).toHaveText('')
  await editor.press('Enter')
  await expect(userMessages.last()).toContainText(previousPrompt)
  await editor.press('Tab')
  await expect(editor).toHaveText(followup)
  await expect(userMessages.last()).toContainText(previousPrompt)

  const modifier = await page.evaluate(() => /Mac/i.test(navigator.platform) ? 'Meta' : 'Control')
  await editor.press(`${modifier}+z`)
  await expect(editor).toHaveText('')
  await expect(editor).toHaveAttribute('data-placeholder', followup)
  await expect(page.getByRole('button', { name: 'Accept suggested prompt' })).toBeVisible()
  await editor.press(`${modifier}+Shift+z`)
  await expect(editor).toHaveText(followup)
  await expect(editor).not.toHaveAttribute('data-placeholder', followup)
  await editor.press(`${modifier}+z`)
  await editor.press('Tab')
  await expect(editor).toHaveText(followup)
  expect(requests).toHaveLength(1)

  const edited = 'Verify that the shortened plan still covers Friday.'
  await editor.fill(edited)
  await editor.press('Enter')
  await expect(userMessages.last()).toContainText(edited)
})

test.describe('mobile composer', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('keeps quick actions available and expands for editing and attachments', async ({ page }) => {
    await openComposer(page, true)
    const editor = composer(page)
    const surface = page.locator('[data-slot="composer-surface"]:visible')
    const add = surface.getByRole('button', { name: 'Add context', exact: true })
    const model = surface.locator('[data-browser-model-pill]')
    const approval = surface.locator('[data-browser-approval-control]')
    const mic = surface.getByRole('button', { name: 'Voice dictation', exact: true })
    const surfaceHeight = () => surface.evaluate(node => node.getBoundingClientRect().height)
    const blurComposer = () => surface.evaluate(node => {
      const focused = document.activeElement
      if (focused instanceof HTMLElement && node.contains(focused)) focused.blur()
    })

    await expect(model).toBeHidden()
    await expect(add).toBeVisible()
    await expect(mic).toBeVisible()
    const compactHeight = await surfaceHeight()

    await editor.tap()
    await expect(editor).toBeFocused()
    await expect(model).toBeVisible()
    await expect(approval).toBeVisible()
    expect(await surfaceHeight()).toBeGreaterThan(compactHeight)
    await model.tap()
    await expect(page.getByRole('textbox', { name: 'Search models' })).toBeVisible()
    await page.keyboard.press('Escape')

    await editor.fill('A draft worth keeping')
    await editor.press('Shift+Enter')
    await editor.pressSequentially('Second line')
    await blurComposer()
    await expect(model).toBeVisible()
    await expect.poll(() => editor.innerText()).toBe('A draft worth keeping\nSecond line')

    await editor.fill('')
    await blurComposer()
    await expect(model).toBeHidden()
    await expect.poll(surfaceHeight).toBeCloseTo(compactHeight)

    await add.tap()
    const picker = page.waitForEvent('filechooser')
    await page.getByRole('menuitem', { name: 'Files…', exact: true }).tap()
    await (await picker).setFiles({
      name: 'mobile-draft.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Keep the attachment visible')
    })
    await expect(surface.locator('[data-slot="composer-attachments"]')).toContainText('mobile-draft.txt')
    await blurComposer()
    await expect(model).toBeVisible()
    await expect(surface.locator('[data-browser-send-action]')).toBeEnabled()
  })
})

test.describe('touch composer predictions', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('touch users can accept the suggestion or type their own message in the same composer', async ({ page }) => {
    const requests = await interceptPredictions(page, true)
    const editor = composer(page)
    const accept = page.getByRole('button', { name: 'Accept suggested prompt' })
    const send = page.locator('[data-browser-send-action]:visible')
    const userMessages = page.locator('[data-slot="aui_user-message-root"]')
    const editorHeight = () => editor.evaluate(node => node.getBoundingClientRect().height)
    const compactHeight = await editorHeight()

    await editor.fill('Outline the launch checklist.')
    await send.tap()
    await editor.evaluate(node => node.blur())
    await expect.poll(() => requests.length).toBe(1)
    requests[0].resolve(followup)
    await expect(editor).toHaveAttribute('data-placeholder', followup)
    await expect.poll(editorHeight).toBeCloseTo(compactHeight)
    await expect(accept).toBeVisible()
    await accept.tap()
    await expect(editor).toHaveText(followup)
    await expect(userMessages.last()).toContainText('Outline the launch checklist.')
    await editor.evaluate(node => {
      node.focus()
      node.dispatchEvent(new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true }))
    })
    await expect(editor).toHaveText('')
    await expect(accept).toBeVisible()
    await accept.tap()
    await expect(editor).toHaveText(followup)
    await expect(send).toBeVisible()
    await send.tap()
    await expect(userMessages.last()).toContainText(followup)

    await expect.poll(() => requests.length).toBe(2)
    requests[1].resolve('Share the revised checklist with the team.')
    await expect(accept).toBeVisible()
    await editor.fill('Check the rollout date first.')
    await expect(accept).toBeHidden()
    await expect(send).toBeVisible()
    await send.tap()
    await expect(userMessages.last()).toContainText('Check the rollout date first.')
  })
})

test('a prediction that arrives after typing starts leaves the draft alone', async ({ page }) => {
  const requests = await interceptPredictions(page)
  const editor = composer(page)
  await editor.fill('Draft an agenda for Friday.')
  await editor.press('Enter')
  await expect.poll(() => requests.length).toBe(1)
  await editor.fill('My own follow-up')
  requests[0].resolve(followup)
  await expect(editor).toHaveText('My own follow-up')
  await editor.fill('')
  await expect(editor).not.toHaveAttribute('data-placeholder', followup)
  await editor.press('Tab')
  await expect(editor).toHaveText('')
})
