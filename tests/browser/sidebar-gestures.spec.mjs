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

async function openSidebar(page, { combined = false, occupied = false, failMove = false, sourceProfile = 'default' } = {}) {
  const moves = []
  await page.route('**/api/athena/preferences', route => route.abort())
  await page.addInitScript(combined => {
    localStorage.setItem('hermes-web.browser.hermes.desktop.sidebarGrouping.allProfiles', combined ? 'project' : 'none')
    localStorage.setItem('hermes-web.browser.hermes.desktop.sidebarAgentsGrouped.allProfiles', 'true')
    localStorage.setItem('hermes-web.browser.combined-profiles', String(combined))
  }, combined)
  const sessions = [...app.gateway.sessions.values()].filter(session => !session.hidden).map(session => ({
    ...session, profile: session.id === 'preview-idea' ? sourceProfile : session.profile
  }))
  const sessionPage = rows => ({ sessions: rows, total: rows.length, has_more: false, limit: 40, offset: 0 })
  if (sourceProfile !== 'default') {
    // Keep live recents and project previews consistent about the row's owner.
    await page.route('**/api/profiles/sessions/sidebar**', route => route.fulfill({ json: {
      recents: sessionPage(sessions), cron: sessionPage([]), messaging: sessionPage([])
    } }))
  }
  const membership = new Map(sessions.map(session => [session.id, occupied ? session.id === 'preview-idea' ? 'drop-project' : 'other-project' : '__no_project__']))
  const project = (id, label, path, extra = {}) => {
    const rows = sessions.filter(session => membership.get(session.id) === id)
    return { id, label, path, sessionCount: rows.length, sessionIds: rows.map(session => session.id), previewSessions: rows, repos: [], ...extra }
  }
  await page.route('**/api/profiles/projects/tree?**', route => route.fulfill({ json: {
    projects: [
      project('__no_project__', 'Home', null, { isNoProject: true }),
      project('drop-project', 'Drop destination', '/workspace/destination'),
      project('other-project', 'Other project', '/workspace/other')
    ], active_id: null, scoped_session_ids: sessions.map(session => session.id)
  } }))
  await page.routeWebSocket(/\/api\/ws/, socket => {
    const server = socket.connectToServer()
    socket.onMessage(message => {
      const frame = JSON.parse(String(message))
      if (frame.method === 'session.workspace.move') {
        moves.push(frame.params)
        if (failMove) socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: 5007, message: 'Move refused by server' } }))
        else {
          membership.set(frame.params.session_key, frame.params.cwd === '/workspace/destination' ? 'drop-project' : 'other-project')
          socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { cwd: frame.params.cwd } }))
        }
      } else if (frame.method === 'session.list' && sourceProfile !== 'default') {
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: sessionPage(sessions) }))
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

async function aimDrop(page, { session = 'preview-week', project = 'drop-project' } = {}) {
  const row = page.locator(`[data-web-session-id="${session}"] .browser-session-title`).first()
  const target = page.locator(`[data-sessions-project="${project}"]`).first()
  const start = await row.boundingBox(), end = await target.boundingBox()
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 1 })
  await expect(target).toHaveAttribute('data-session-drop-active', '')
  return target
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
  await expect(page.locator('[data-sessions-project="drop-project"] [data-web-session-id="preview-week"]')).toBeVisible()
})

for (const combined of [false, true]) {
  test(`dragging an inactive chat moves it between populated projects (combined profiles: ${combined})`, async ({ page }) => {
    const { moves, editor } = await openSidebar(page, { combined, occupied: true })
    await aimDrop(page, { session: 'preview-idea', project: 'other-project' })
    await page.mouse.up()
    await expect.poll(() => moves).toEqual([
      { cwd: '/workspace/other', profile: 'default', session_key: 'preview-idea' }
    ])
    await expect(page.locator('[data-sessions-project="other-project"] [data-web-session-id="preview-idea"]')).toBeVisible()
    await expect(page).toHaveURL(/#\/preview-week$/)
    await expect(editor).toHaveText('Keep the draft through sidebar gestures')
    await expect(page.locator('[data-session-moving], [data-session-drop-active], [data-session-project-dragging]')).toHaveCount(0)
  })
}

test('dropping within the same project or outside a destination leaves the chat in place', async ({ page }) => {
  const { moves, editor } = await openSidebar(page, { occupied: true })
  const row = page.locator('[data-web-session-id="preview-idea"] .browser-session-title').first()
  const start = await row.boundingBox()
  await page.mouse.move(start.x + 20, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(start.x + 50, start.y + start.height / 2)
  await expect(page.locator('[data-session-moving]')).toHaveCount(1)
  await expect(page.locator('[data-session-drop-active]')).toHaveCount(0)
  await page.mouse.up()
  await aimDrop(page)
  await page.mouse.move(1200, 500)
  await expect(page.locator('[data-session-drop-active]')).toHaveCount(0)
  await page.mouse.up()
  expect(moves).toEqual([])
  await expect(page).toHaveURL(/#\/preview-week$/)
  await expect(editor).toHaveText('Keep the draft through sidebar gestures')
})

test('a rejected move reports the error and keeps the chat and draft in place', async ({ page }) => {
  const { moves, editor } = await openSidebar(page, { failMove: true })
  await aimDrop(page)
  await page.mouse.up()
  await expect.poll(() => moves.length).toBe(1)
  await expect(page.getByText('Move refused by server', { exact: false })).toBeVisible()
  await expect(page.locator('[data-sessions-project="__no_project__"] [data-web-session-id="preview-week"]')).toBeVisible()
  await expect(page.locator('[data-session-moving], [data-session-drop-active], [data-session-project-dragging]')).toHaveCount(0)
  await expect(editor).toHaveText('Keep the draft through sidebar gestures')
})

test('moving a chat from another profile uses that row owner', async ({ page }) => {
  const { moves, editor } = await openSidebar(page, { occupied: true, sourceProfile: 'research' })
  await aimDrop(page, { session: 'preview-idea', project: 'other-project' })
  await page.mouse.up()
  await expect.poll(() => moves).toEqual([{ cwd: '/workspace/other', profile: 'research', session_key: 'preview-idea' }])
  await expect(page).toHaveURL(/#\/preview-week$/)
  await expect(editor).toHaveText('Keep the draft through sidebar gestures')
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
