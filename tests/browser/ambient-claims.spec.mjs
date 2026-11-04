import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

let application, origin
test.beforeAll(async () => { application = await createBuiltApplication(); origin = application.origin })
test.afterAll(async () => { await application?.close() })
const composer = page => page.locator('[data-slot="composer-rich-input"]:visible').first()
const claim = (page, key) => page.evaluate(key => window.hermesDesktop.claimAmbientCue(key), key)
async function openApp(page) {
  await page.goto(`${origin}/#/preview-week`)
  await expect(composer(page)).toBeVisible({ timeout: 30000 })
  await composer(page).fill('Keep this draft while coordinating ambient cues')
}

test('detached app windows share cue ownership and retain speech claims across reloads', async ({ page }) => {
  await openApp(page)
  await page.evaluate(() => {
    const button = document.createElement('button')
    button.textContent = 'Open ambient peer'
    button.onclick = () => {
      window.peerResult = null
      window.hermesDesktop.openSessionWindow('preview-idea').then(result => { window.peerResult = result },
        error => { window.peerResult = { error: error.message } })
    }
    document.body.prepend(button)
  })
  const opening = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Open ambient peer', exact: true }).click()
  const peer = await opening
  try {
    await expect(composer(peer)).toBeVisible({ timeout: 30000 })
    expect(await peer.evaluate(() => window.opener)).toBeNull()
    await expect.poll(() => page.evaluate(() => window.peerResult)).toEqual({ ok: true })
    await composer(peer).fill('Keep the detached window draft')
    const speech = 'speak:turn:shared-reply', cue = 'turn-end:shared-reply'
    expect((await Promise.all([claim(page, speech), claim(peer, speech)])).sort()).toEqual([false, true])
    expect((await Promise.all([claim(page, cue), claim(peer, cue)])).sort()).toEqual([false, true])
    expect(await Promise.all([claim(page, 'speak:turn:distinct-a'), claim(peer, 'speak:turn:distinct-b')])).toEqual([true, true])
    // Speech claims must outlive the ordinary one-second cue interval.
    await page.waitForTimeout(1100)
    expect(await claim(peer, speech)).toBe(false)
    expect(await claim(peer, cue)).toBe(true)
    await peer.reload()
    await expect(composer(peer)).toHaveText('Keep the detached window draft')
    expect(await claim(peer, speech)).toBe(false)
    await expect(composer(page)).toHaveText('Keep this draft while coordinating ambient cues')
    await expect(page).toHaveURL(`${origin}/#/preview-week`)
  } finally { await peer.close() }
})

for (const mode of ['unavailable', 'refused']) {
  test(`ambient cues remain available when SharedWorker is ${mode}`, async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(mode => {
      Object.defineProperty(window, 'SharedWorker', { configurable: true, value: mode === 'unavailable' ? undefined : class {
        constructor() { throw new Error('Worker access refused') }
      } })
    }, mode)
    await openApp(page)
    expect(await claim(page, 'speak:turn:unsupported-worker')).toBe(true)
    expect(await claim(page, 'speak:turn:unsupported-worker')).toBe(true)
    await expect(composer(page)).toHaveText('Keep this draft while coordinating ambient cues')
    expect(errors).toEqual([])
  })
}
