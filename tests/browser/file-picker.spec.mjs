import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

let application, origin
test.beforeAll(async () => { application = await createBuiltApplication(); origin = application.origin })
test.afterAll(async () => { await application?.close() })
const composer = page => page.locator('[data-slot="composer-rich-input"]:visible').first()
test.beforeEach(async ({ page }) => {
  await page.goto(`${origin}/#/preview-week`)
  await expect(composer(page)).toBeVisible({ timeout: 30000 })
  await composer(page).fill('Keep this draft while choosing files')
  await page.evaluate(() => {
    window.pickerResults = {}; window.pickerSequence = 0
    const button = document.createElement('button')
    button.textContent = 'Choose test file'
    button.onclick = () => {
      const id = ++window.pickerSequence
      window.pickerResults[id] = { pending: true }
      window.hermesDesktop.selectPaths({ multiple: false, filters: [{ name: 'Text', extensions: ['TXT'] }] }).then(
        paths => { window.pickerResults[id] = { paths } }, error => { window.pickerResults[id] = { error: error.message } })
    }
    document.body.prepend(button)
  })
})
const choose = page => page.getByRole('button', { name: 'Choose test file', exact: true }).click()
async function openChooser(page) {
  const opening = page.waitForEvent('filechooser')
  await choose(page)
  return opening
}
async function checkBytes(page, request, name, text) {
  await expect.poll(() => page.evaluate(id => window.pickerResults[id]?.paths?.length, request)).toBe(1)
  const result = await page.evaluate(async id => {
    const [path] = window.pickerResults[id].paths
    return { path, bytes: await window.hermesDesktop.readFileDataUrlForAttach(path) }
  }, request)
  expect(result.path).toMatch(new RegExp(`^web-file://\\d+/${name.replaceAll('.', '\\.')}$`))
  expect(Buffer.from(result.bytes.split(',')[1], 'base64').toString()).toBe(text)
  await expect(composer(page)).toHaveText('Keep this draft while choosing files')
}

test('a refused picker can retry without stale listeners or losing its selected bytes', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const inputs = await page.locator('input[type="file"]').count()
  await page.evaluate(() => {
    const click = HTMLInputElement.prototype.click
    let refused = false
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file' && !refused) { refused = true; throw new Error('Picker refused') }
      return click.call(this)
    }
  })
  await choose(page)
  await expect.poll(() => page.evaluate(() => window.pickerResults[1])).toEqual({ error: 'Picker refused' })
  const picker = await openChooser(page)
  expect(picker.isMultiple()).toBe(false)
  expect(await picker.element().getAttribute('accept')).toBe('.txt')
  await picker.setFiles({ name: 'retry.txt', mimeType: 'text/plain', buffer: Buffer.from('retry payload') })
  await checkBytes(page, 2, 'retry.txt', 'retry payload')
  await expect(page.locator('input[type="file"]')).toHaveCount(inputs)
  expect(errors).toEqual([])
})

test('a new request releases an unanswered picker and owns a separate input', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const inputs = await page.locator('input[type="file"]').count()
  await page.evaluate(() => {
    const click = HTMLInputElement.prototype.click
    let unanswered = false
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file' && !unanswered) { unanswered = true; window.unansweredPickerInput = this; return }
      return click.call(this)
    }
  })
  await choose(page)
  await expect.poll(() => page.evaluate(() => window.pickerResults[1])).toEqual({ pending: true })
  const picker = await openChooser(page)
  await expect.poll(() => page.evaluate(() => window.pickerResults[1])).toEqual({ paths: [] })
  expect(await picker.element().evaluate(input => input !== window.unansweredPickerInput)).toBe(true)
  expect(await page.evaluate(() => window.unansweredPickerInput.isConnected)).toBe(false)
  await page.evaluate(() => window.unansweredPickerInput.dispatchEvent(new Event('change')))
  expect(await page.evaluate(() => window.pickerResults[2])).toEqual({ pending: true })
  await picker.setFiles({ name: 'current.txt', mimeType: 'text/plain', buffer: Buffer.from('current payload') })
  await checkBytes(page, 2, 'current.txt', 'current payload')
  await expect(page.locator('input[type="file"]')).toHaveCount(inputs)
  expect(errors).toEqual([])
})
