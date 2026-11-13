import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

let application
test.beforeAll(async () => { application = await createBuiltApplication() })
test.afterAll(async () => { await application?.close() })

const composer = page => page.locator('[data-slot="composer-rich-input"]:visible').first()
const addToChat = page => page.getByRole('button', { name: 'Add to chat', exact: true })
const response = page => page.getByText(/^Start with three things that matter most this week\./)
const excerpt = 'three things that matter most this week.'

async function openConversation(page) {
  await page.goto(`${application.origin}/#/preview-week`)
  await expect(page.locator('.athena-connecting-overlay')).toHaveCount(0)
  if (!(await response(page).isVisible())) {
    await page.getByRole('button', { name: 'Plan a calmer working week', exact: true }).click()
  }
  await expect(response(page)).toBeVisible()
}

async function selectText(locator, text) {
  return locator.evaluate((node, text) => {
    const start = node.firstChild.textContent.indexOf(text)
    const range = document.createRange()
    range.setStart(node.firstChild, start)
    range.setEnd(node.firstChild, start + text.length)
    window.getSelection().removeAllRanges()
    window.getSelection().addRange(range)
  }, text)
}

test('adding selected transcript text appends an undoable quote to the unsent draft', async ({ page }) => {
  await openConversation(page)
  const editor = composer(page)
  const original = 'Help me plan around this'
  await editor.fill(original)
  const bounds = await response(page).evaluate((node, excerpt) => {
    const text = node.firstChild
    const start = text.textContent.indexOf(excerpt)
    const rectAt = offset => {
      const range = document.createRange()
      range.setStart(text, offset)
      range.collapse(true)
      return range.getBoundingClientRect().toJSON()
    }
    return { start: rectAt(start), end: rectAt(start + excerpt.length) }
  }, excerpt)
  await page.mouse.move(bounds.start.left, bounds.start.top + bounds.start.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.end.left, bounds.end.top + bounds.end.height / 2, { steps: 10 })
  await expect(addToChat(page)).toHaveCount(0)
  await page.mouse.up()

  await expect(addToChat(page)).toBeVisible()
  expect(await page.evaluate(() => window.getSelection().toString())).toBe(excerpt)
  await addToChat(page).click()
  await expect(editor).toBeFocused()
  await expect(addToChat(page)).toHaveCount(0)
  await expect.poll(() => editor.innerText()).toContain(`${original}\n\n> ${excerpt}`)

  const modifier = await page.evaluate(() => /Mac/i.test(navigator.platform) ? 'Meta' : 'Control')
  await editor.press(`${modifier}+z`)
  await expect(editor).toHaveText(original)
  await editor.press(`${modifier}+Shift+z`)
  await page.keyboard.type('Can we start today?')
  const followUp = `${original}\n\n> ${excerpt}\n\nCan we start today?`
  await expect.poll(() => editor.innerText()).toBe(followUp)
  await page.reload()
  await expect.poll(() => composer(page).innerText()).toBe(followUp)
  await expect(page.getByText(original, { exact: true })).toHaveCount(0)
})

test('selection actions dismiss on Escape and stay with their source conversation', async ({ page }) => {
  await openConversation(page)
  const editor = composer(page)
  await editor.fill('Draft selection only')
  await selectText(editor, 'selection')
  await expect(addToChat(page)).toHaveCount(0)

  await selectText(response(page), excerpt)
  await expect(addToChat(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(addToChat(page)).toHaveCount(0)
  expect(await page.evaluate(() => window.getSelection().toString())).toBe('')

  await selectText(response(page), excerpt)
  await expect(addToChat(page)).toBeVisible()
  await page.evaluate(() => { window.location.hash = '/preview-idea' })
  await expect(page.getByText(/^A useful starting point is one person/)).toBeVisible()
  await expect(addToChat(page)).toHaveCount(0)
  await expect(composer(page)).toBeEmpty()
})

test.describe('touch selection', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  test('a selected reply can be added by tapping the control', async ({ page }) => {
    await openConversation(page)
    await selectText(response(page), excerpt)
    await expect(addToChat(page)).toBeVisible()
    await addToChat(page).tap()
    await expect.poll(() => composer(page).innerText()).toContain(`> ${excerpt}`)
    await expect(addToChat(page)).toHaveCount(0)
  })
})
