import { expect } from '@playwright/test'
import { test, editor, openConversation } from './gateway-fixture.mjs'

test.setTimeout(60000)
test.use({ viewport: { width: 1440, height: 960 } })

test.extend({ contextOptions: { hasTouch: true } })('phone navigation closes for session changes while preserving drafts', async ({ page, gatewayApp }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openConversation(page, gatewayApp.origin)
  await editor(page).fill('Keep the first phone conversation draft')
  const openNavigation = () => page.getByRole('button', { name: 'Back to chat history', exact: true }).click()
  await openNavigation()
  await page.getByText('Explore a product idea', { exact: true }).first().click()
  await expect(page.locator('[data-browser-conversation-id]')).toHaveAttribute('data-browser-conversation-id', 'preview-idea')
  await expect(page.locator('#browser-navigation')).toBeHidden()
  await editor(page).fill('Keep the second phone conversation draft')
  await openNavigation()
  await page.getByRole('button', { name: 'Plan a calmer working week', exact: true }).click()
  await expect(editor(page)).toHaveText('Keep the first phone conversation draft')
  await openNavigation()
  await page.getByText('Explore a product idea', { exact: true }).first().click()
  await expect(editor(page)).toHaveText('Keep the second phone conversation draft')
  await expect(page.locator('#browser-navigation')).toBeHidden()
})

test('reconnect preserves the selected conversation and its draft', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  await editor(page).fill('Keep this draft across reconnect')
  const attachments = () => gatewayApp.controls.calls.filter(call =>
    ['session.resume', 'session.activate'].includes(call.method) && call.params.session_id === 'preview-week'
  ).length
  const before = attachments()
  gatewayApp.disconnect()
  await expect.poll(attachments, { timeout: 30000 }).toBeGreaterThan(before)
  await expect(page).toHaveURL(/#\/preview-week$/)
  await expect(editor(page)).toHaveText('Keep this draft across reconnect')
})

for (const action of ['archive', 'delete']) {
  test(`rejected ${action} keeps the chat and draft and explains the failure`, async ({ page, gatewayApp }) => {
    await openConversation(page, gatewayApp.origin)
    await editor(page).fill('Keep this draft after a rejected action')
    gatewayApp.controls.reject({ transport: 'http', method: action === 'delete' ? 'DELETE' : 'PATCH', path: '/api/sessions/preview-week' }, `${action} rejected`)
    await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
    await page.getByRole('menuitem', { name: action === 'delete' ? 'Delete' : 'Archive', exact: true }).click()
    if (action === 'delete') await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: `Could not ${action} conversation.` })).toBeVisible()
    await expect(page).toHaveURL(/#\/preview-week$/)
    await expect(editor(page)).toHaveText('Keep this draft after a rejected action')
    expect(gatewayApp.sessions.has('preview-week')).toBe(true)
    expect(gatewayApp.sessions.get('preview-week').archived).not.toBe(true)
  })
}

test('rejected approval change restores the confirmed mode and explains the failure', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  const control = page.locator('.browser-approval-control button')
  await expect(control.locator('[data-mode-name]')).toHaveText('Smart')
  gatewayApp.controls.reject({ transport: 'rpc', method: 'config.set' }, 'Approval rejected')
  await control.click()
  await page.getByRole('menuitemradio', { name: /Off/ }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not change approval mode.' })).toBeVisible()
  await expect(control.locator('[data-mode-name]')).toHaveText('Smart')
})

test('a delayed archive cannot navigate away from a newer conversation', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  const archive = gatewayApp.controls.hold({ transport: 'http', method: 'PATCH', path: '/api/sessions/preview-week' })
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
  await archive.entered
  await page.getByText('Explore a product idea', { exact: true }).first().click()
  await expect(page).toHaveURL(/#\/preview-idea$/)
  await editor(page).fill('Keep the newer conversation draft')
  const completed = page.waitForResponse(response => response.url().includes('/api/sessions/preview-week') && response.request().method() === 'PATCH')
  archive.release()
  await completed
  await expect(page.getByRole('button', { name: 'Plan a calmer working week', exact: true })).toHaveCount(0)
  await expect(page).toHaveURL(/#\/preview-idea$/)
  await expect(editor(page)).toHaveText('Keep the newer conversation draft')
})


test('rejected unread change rolls back the action and preserves the draft', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  await editor(page).fill('Keep the unread-action draft')
  gatewayApp.controls.reject({ transport: 'http', method: 'PATCH', path: '/api/sessions/preview-week' }, 'Unread rejected')
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Mark as unread', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not change unread status.' })).toBeVisible()
  await expect(editor(page)).toHaveText('Keep the unread-action draft')
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Mark as unread', exact: true })).toBeVisible()
})

test('a delayed delete cannot navigate away from a newer conversation', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin, 'preview-idea')
  await editor(page).fill('Keep the newer conversation after deletion')
  await page.getByText('Plan a calmer working week', { exact: true }).first().click()
  await expect(page).toHaveURL(/#\/preview-week$/)
  const deletion = gatewayApp.controls.hold({ transport: 'http', method: 'DELETE', path: '/api/sessions/preview-week' })
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await deletion.entered
  // Browser address/history navigation can change the route while confirmation is busy.
  await page.evaluate(() => { location.hash = '/preview-idea' })
  await expect(page).toHaveURL(/#\/preview-idea$/)
  await expect(editor(page)).toHaveText('Keep the newer conversation after deletion')
  const completed = page.waitForResponse(response => response.url().includes('/api/sessions/preview-week') && response.request().method() === 'DELETE')
  deletion.release()
  await completed
  await expect(page.getByRole('button', { name: 'Plan a calmer working week', exact: true })).toHaveCount(0)
  await expect(page).toHaveURL(/#\/preview-idea$/)
  await expect(editor(page)).toHaveText('Keep the newer conversation after deletion')
})

for (const action of ['archive', 'delete']) {
  test(`unconfirmed ${action} leaves the conversation intact`, async ({ page, gatewayApp }) => {
    await openConversation(page, gatewayApp.origin)
    await editor(page).fill('Keep this draft without confirmation')
    let intercepted = false
    await page.route(/\/api\/sessions\/preview-week(?:\?|$)/, route => {
      if (route.request().method() === (action === 'archive' ? 'PATCH' : 'DELETE')) {
        intercepted = true
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
      }
      return route.continue()
    })
    await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
    await page.getByRole('menuitem', { name: action === 'archive' ? 'Archive' : 'Delete', exact: true }).click()
    if (action === 'delete') await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: `Could not ${action} conversation.` })).toBeVisible()
    await expect(page).toHaveURL(/#\/preview-week$/)
    await expect(editor(page)).toHaveText('Keep this draft without confirmation')
    expect(intercepted).toBe(true)
    expect(gatewayApp.sessions.has('preview-week')).toBe(true)
  })
}

test('unread action labels follow the persisted state', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  await editor(page).fill('Keep this draft while changing unread state')
  for (const unread of [true, false]) {
    await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
    await page.getByRole('menuitem', { name: unread ? 'Mark as unread' : 'Mark as read', exact: true }).click()
    await expect.poll(() => gatewayApp.sessions.get('preview-week').unread).toBe(unread)
  }
  await expect(editor(page)).toHaveText('Keep this draft while changing unread state')
})

test('an older unread failure cannot undo newer toggles', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  await editor(page).fill('Keep this draft through overlapping unread changes')
  let release, entered
  const held = new Promise(resolve => { release = resolve })
  const observed = new Promise(resolve => { entered = resolve })
  let first = true
  await page.route(/\/api\/sessions\/preview-week(?:\?|$)/, async route => {
    if (route.request().method() !== 'PATCH' || typeof route.request().postDataJSON()?.unread !== 'boolean' || !first) return route.continue()
    first = false
    entered()
    await held
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Older unread change rejected' }) })
  })
  const toggle = async unread => {
    await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
    await page.getByRole('menuitem', { name: unread ? 'Mark as unread' : 'Mark as read', exact: true }).click()
  }
  try {
    await toggle(true)
    await observed
    await toggle(false)
    await toggle(true)
    const failed = page.waitForResponse(response => response.url().includes('/api/sessions/preview-week') && response.status() === 503)
    release()
    await failed
    await expect.poll(() => gatewayApp.controls.calls.filter(call => call.transport === 'http' && call.method === 'PATCH' && call.path === '/api/sessions/preview-week').length).toBe(2)
    await expect.poll(() => gatewayApp.sessions.get('preview-week').unread).toBe(true)
    await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Mark as read', exact: true })).toBeVisible()
    await expect(editor(page)).toHaveText('Keep this draft through overlapping unread changes')
    await expect(page.getByRole('alert').filter({ hasText: 'Could not change unread status.' })).toHaveCount(0)
  } finally { release() }
})

test('delayed unread writes preserve the final choice on the gateway', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  const first = gatewayApp.controls.hold({ transport: 'http', method: 'PATCH', path: '/api/sessions/preview-week' })
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Mark as unread', exact: true }).click()
  await first.entered
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Mark as read', exact: true }).click()
  const completed = page.waitForResponse(response => response.url().includes('/api/sessions/preview-week') && response.request().method() === 'PATCH' && response.request().postDataJSON()?.unread === true)
  first.release()
  await completed
  await expect.poll(() => gatewayApp.controls.calls.filter(call => call.transport === 'http' && call.method === 'PATCH' && call.path === '/api/sessions/preview-week').length).toBe(2)
  await expect.poll(() => gatewayApp.sessions.get('preview-week').unread).toBe(false)
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Mark as unread', exact: true })).toBeVisible()
})

test('unconfirmed unread writes restore the confirmed choice and explain the failure', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  await page.route(/\/api\/sessions\/preview-week(?:\?|$)/, route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
    : route.continue())
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Mark as unread', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not change unread status.' })).toBeVisible()
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Mark as unread', exact: true })).toBeVisible()
})

test('opening a session queues its automatic read behind a pending unread write', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  const first = gatewayApp.controls.hold({ transport: 'http', method: 'PATCH', path: '/api/sessions/preview-week' })
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Mark as unread', exact: true }).click()
  await first.entered
  await page.getByText('Explore a product idea', { exact: true }).first().click()
  await expect(page).toHaveURL(/#\/preview-idea$/)
  await page.getByText('Plan a calmer working week', { exact: true }).first().click()
  await expect(page).toHaveURL(/#\/preview-week$/)
  const completed = page.waitForResponse(response => response.url().includes('/api/sessions/preview-week') && response.request().method() === 'PATCH' && response.request().postDataJSON()?.unread === true)
  first.release()
  await completed
  await expect.poll(() => gatewayApp.controls.calls.filter(call => call.transport === 'http' && call.method === 'PATCH' && call.path === '/api/sessions/preview-week').length).toBe(2)
  await expect.poll(() => gatewayApp.sessions.get('preview-week').unread).toBe(false)
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Mark as unread', exact: true })).toBeVisible()
})

test('approval initialization waits for the gateway without a false action error', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  await expect(page.locator('.browser-approval-control [data-mode-name]')).toHaveText('Smart')
  await expect.poll(() => gatewayApp.controls.calls.some(call => call.method === 'config.get' && call.params.key === 'approvals.mode')).toBe(true)
  await expect(page.getByRole('alert').filter({ hasText: 'Could not load approval mode.' })).toHaveCount(0)
})


test('profile commands preserve the conversation draft across scope changes and reload', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  await editor(page).fill('Keep the draft while browsing other profiles')
  const writer = page.locator('[data-profile-key="writer"]')
  await writer.click()
  await expect(writer).toHaveAttribute('aria-pressed', 'true')
  await expect(editor(page)).toHaveText('Keep the draft while browsing other profiles')
  await page.reload()
  await expect(writer).toHaveAttribute('aria-pressed', 'true', { timeout: 30000 })
  await expect(editor(page)).toHaveText('Keep the draft while browsing other profiles', { timeout: 30000 })
  const all = page.getByRole('button', { name: 'All profiles', exact: true })
  await all.click()
  await expect(all).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => window.__HERMES_WEB_ACTIVE_PROFILE__)).toBe(null)
  await expect(editor(page)).toHaveText('Keep the draft while browsing other profiles')
  await page.reload()
  await expect(all).toHaveAttribute('aria-pressed', 'true', { timeout: 30000 })
  await expect(editor(page)).toHaveText('Keep the draft while browsing other profiles', { timeout: 30000 })
})

test('profile visibility survives navigation when preference storage is unavailable', async ({ page, gatewayApp }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'hermes-web.browser.hidden-profiles') throw new Error('Preference storage unavailable')
      return original.call(this, key, value)
    }
  })
  await openConversation(page, gatewayApp.origin)
  await editor(page).fill('Keep the draft across profile navigation')
  const writer = page.locator('[data-profile-key="writer"]')
  await writer.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Profiles', exact: true }).hover()
  await page.getByRole('menuitemcheckbox', { name: 'Writer', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(writer).toHaveCount(0)
  const profiles = page.getByRole('navigation', { name: 'App navigation' }).locator('.browser-app-rail')
  await expect(profiles).toBeVisible()
  await page.getByRole('button', { name: 'Explore a product idea', exact: true }).click()
  await expect(page).toHaveURL(/#\/preview-idea$/)
  await page.getByRole('button', { name: 'Plan a calmer working week', exact: true }).click()
  await expect(writer).toHaveCount(0)
  await expect(editor(page)).toHaveText('Keep the draft across profile navigation')
})

test('a rejected pin restores confirmed state and preserves the draft', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  await editor(page).fill('Keep this draft when pinning fails')
  gatewayApp.controls.reject({ transport: 'http', method: 'PATCH', path: '/api/sessions/preview-week' }, 'Pin rejected')
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not change pinned status.' })).toBeVisible()
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Pin', exact: true })).toBeVisible()
  await expect(editor(page)).toHaveText('Keep this draft when pinning fails')
  expect(gatewayApp.sessions.get('preview-week').pinned).not.toBe(true)
})

test('delayed pin writes preserve the latest choice on the gateway', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  const first = gatewayApp.controls.hold({ transport: 'http', method: 'PATCH', path: '/api/sessions/preview-week' })
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click()
  await first.entered
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Unpin', exact: true }).click()
  const completed = page.waitForResponse(response => response.url().includes('/api/sessions/preview-week') && response.request().method() === 'PATCH' && response.request().postDataJSON()?.pinned === true)
  first.release()
  await completed
  await expect.poll(() => gatewayApp.controls.calls.filter(call => call.transport === 'http' && call.method === 'PATCH' && call.path === '/api/sessions/preview-week').length).toBe(2)
  await expect.poll(() => gatewayApp.sessions.get('preview-week').pinned).toBe(false)
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Pin', exact: true })).toBeVisible()
})

test('an unconfirmed pin rolls back and explains the failure', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  await page.route(/\/api\/sessions\/preview-week(?:\?|$)/, route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
    : route.continue())
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not change pinned status.' })).toBeVisible()
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Pin', exact: true })).toBeVisible()
})

test('a rejected unpin restores the confirmed pin and can be retried', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click()
  await expect.poll(() => gatewayApp.sessions.get('preview-week').pinned).toBe(true)
  gatewayApp.controls.reject({ transport: 'http', method: 'PATCH', path: '/api/sessions/preview-week' }, 'Unpin rejected')
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Unpin', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not change pinned status.' })).toBeVisible()
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Unpin', exact: true }).click()
  await expect.poll(() => gatewayApp.sessions.get('preview-week').pinned).toBe(false)
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Pin', exact: true })).toBeVisible()
})

test('the command center opens a session in the browser conversation view', async ({ page, gatewayApp }) => {
  await openConversation(page, gatewayApp.origin)
  await editor(page).fill('Keep the previous conversation draft')
  await page.keyboard.press('ControlOrMeta+k')
  const command = page.getByRole('combobox')
  await expect(command).toBeFocused()
  await command.fill('Explore a product idea')
  const choice = page.getByRole('group', { name: 'Sessions', exact: true }).getByRole('option', { name: /Explore a product idea/ })
  await expect(choice).toBeVisible()
  const bounds = await choice.boundingBox()
  // Keyboard-first overlays enable pointer selection after actual movement.
  await page.mouse.move(bounds.x + 8, bounds.y + 8)
  await choice.click()
  await expect(page).toHaveURL(/#\/preview-idea$/)
  await expect(page.locator('[data-browser-conversation-id]')).toHaveAttribute('data-browser-conversation-id', 'preview-idea')
  await expect(page.getByText('A useful starting point is one person, one problem, and one small experiment.', { exact: false }).first()).toBeVisible()
  await page.getByText('Plan a calmer working week', { exact: true }).first().click()
  await expect(editor(page)).toHaveText('Keep the previous conversation draft')
})
