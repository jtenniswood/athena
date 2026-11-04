import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

let app
const pageErrors = new WeakMap()
test.use({ viewport: { width: 1440, height: 960 } })
test.beforeAll(async () => { app = await createBuiltApplication() })
test.afterAll(async () => { await app?.close() })
test.beforeEach(async ({ page }) => {
  const errors = []
  pageErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
})
test.afterEach(async ({ page }) => { expect(pageErrors.get(page)).toEqual([]) })

async function openSidebar(page) {
  const moves = []
  await page.route('**/api/athena/preferences', route => route.abort())
  await page.addInitScript(() => {
    localStorage.setItem('hermes-web.browser.hermes.desktop.sidebarGrouping.allProfiles', 'none')
    localStorage.setItem('hermes-web.browser.hermes.desktop.sidebarAgentsGrouped.allProfiles', 'true')
  })
  const sessions = [...app.gateway.sessions.values()].filter(session => !session.hidden)
  await page.route('**/api/profiles/projects/tree?**', route => route.fulfill({ json: {
    projects: [
      { id: '__no_project__', label: 'Home', path: null, isNoProject: true, sessionCount: sessions.length, sessionIds: sessions.map(session => session.id), previewSessions: sessions, repos: [] },
      { id: 'drop-project', label: 'Drop destination', path: '/workspace/destination', sessionCount: 0, repos: [] }
    ], active_id: null, scoped_session_ids: sessions.map(session => session.id)
  } }))
  await page.routeWebSocket(/\/api\/ws/, socket => {
    const server = socket.connectToServer()
    socket.onMessage(message => {
      const frame = JSON.parse(String(message))
      if (frame.method === 'session.workspace.move') {
        moves.push(frame.params)
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { cwd: frame.params.cwd } }))
      } else server.send(message)
    })
    server.onMessage(message => socket.send(message))
  })
  await page.goto(`${app.origin}/#/preview-week`)
  const editor = page.locator('[contenteditable="true"]:visible').first()
  await expect(editor).toBeVisible()
  await expect(page.locator('.athena-connecting-overlay')).toHaveCount(0)
  await editor.fill('Keep the draft through sidebar gestures')
  return { moves, editor }
}

async function aimDrop(page) {
  const row = page.locator('[data-web-session-id="preview-week"] .browser-session-title').first()
  const target = page.locator('[data-sessions-project="drop-project"]')
  const start = await row.boundingBox(), end = await target.boundingBox()
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 1 })
  await expect(target).toHaveAttribute('data-session-drop-active', '')
}

test('Escape cancels a project drop before pointer release', async ({ page }) => {
  const { moves, editor } = await openSidebar(page)
  await aimDrop(page)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(moves).toEqual([])
  await expect(page.locator('[data-session-drop-active]')).toHaveCount(0)
  await expect(editor).toHaveText('Keep the draft through sidebar gestures')
})

test('an uninterrupted project drop uses the session profile and keeps the draft', async ({ page }) => {
  const { moves, editor } = await openSidebar(page)
  await aimDrop(page)
  await page.mouse.up()
  await expect.poll(() => moves).toEqual([{ cwd: '/workspace/destination', profile: 'default', session_key: 'preview-week' }])
  await expect(page.locator('[data-session-drop-active]')).toHaveCount(0)
  await expect(editor).toHaveText('Keep the draft through sidebar gestures')
  await expect(page).toHaveURL(/#\/preview-week$/)
})

// Engine reconciliation can remove nodes while a pointer is still held. Remove
// the actual nodes to exercise that mounted lifetime without a second mouse press.
for (const change of ['source row', 'destination', 'window focus']) {
  test(`losing the ${change} cancels a pending project drop`, async ({ page }) => {
    const { moves, editor } = await openSidebar(page)
    await aimDrop(page)
    if (change === 'source row') {
      await page.locator('[data-web-session-id="preview-week"]').first().evaluate(element => element.remove())
    } else if (change === 'destination') {
      await page.locator('[data-sessions-project="drop-project"]').evaluate(element => element.remove())
    } else {
      await page.evaluate(() => window.dispatchEvent(new Event('blur')))
      await expect(page.locator('[data-session-drop-active]')).toHaveCount(0)
    }
    await page.mouse.up()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(moves).toEqual([])
    await expect(page.locator('[data-session-drop-active]')).toHaveCount(0)
    await expect(editor).toHaveText('Keep the draft through sidebar gestures')
  })
}
