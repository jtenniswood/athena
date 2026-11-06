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

async function openSidebar(page, { combined = false, occupied = false, failMove = false, sourceProfile = 'default', grouped = true, dateGrouping = false } = {}) {
  const moves = []
  await page.route('**/api/athena/preferences', route => route.abort())
  await page.addInitScript(({ combined, grouped, dateGrouping }) => {
    localStorage.setItem('hermes-web.browser.hermes.desktop.sidebarGrouping.allProfiles', dateGrouping ? 'date' : combined ? 'project' : 'none')
    localStorage.setItem('hermes-web.browser.hermes.desktop.sidebarAgentsGrouped.allProfiles', String(grouped))
    localStorage.setItem('hermes-web.browser.combined-profiles', String(combined))
  }, { combined, grouped, dateGrouping })
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
      if (frame.method === 'session.mutate' && frame.params.operation === 'workspace') {
        const move = { cwd: frame.params.payload.cwd, profile: frame.params.profile, session_key: frame.params.session_id }
        moves.push(move)
        if (failMove) socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: 5007, message: 'Move refused by server' } }))
        else {
          membership.set(move.session_key, move.cwd === '/workspace/destination' ? 'drop-project' : 'other-project')
          socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: {
            session_id: move.session_key, cwd: move.cwd, revision: frame.params.expected_revision + 1, execution_generation: 0
          } }))
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

async function aimOrder(page, { handle = false } = {}) {
  const source = page.locator('[data-web-session-id="preview-idea"]').first()
  const target = page.locator('[data-web-session-id="preview-week"]').first()
  const title = source.locator(handle ? '[data-reorder-handle]' : '.browser-session-title')
  const start = await title.boundingBox(), end = await target.boundingBox()
  const after = start.y < end.y
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  if (handle) {
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 + 10, { steps: 3 })
    await expect(source).toHaveAttribute('data-glass-opaque', '')
  }
  await page.mouse.move(end.x + end.width / 2, end.y + end.height * (after ? .8 : .2), { steps: 10 })
  if (!handle) await expect(target).toHaveAttribute('data-session-order-drop', after ? 'after' : 'before')
  return { source, target, after }
}

for (const [layout, combined, grouped] of [
  ['flat', false, false], ['profiles', true, false],
  ['projects', false, true], ['combined projects', true, true]
]) {
  test(`chat title drops save the order and preserve the draft in ${layout}`, async ({ page }) => {
    const { moves, editor } = await openSidebar(page, { combined, grouped })
    const { source, target, after } = await aimOrder(page)
    await page.mouse.up()
    const isAfter = async () => {
      // Profile/project rows can remount independently while the sidebar reloads.
      const [sourceBounds, targetBounds] = await Promise.all([source.boundingBox(), target.boundingBox()])
      return sourceBounds && targetBounds ? sourceBounds.y > targetBounds.y : undefined
    }
    await expect.poll(isAfter).toBe(after)
    expect(moves).toEqual([])
    await expect(page).toHaveURL(/#\/preview-week$/)
    await expect(editor).toHaveText('Keep the draft through sidebar gestures')
    await expect(page.locator('[data-session-moving], [data-session-order-drop]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Ordering', exact: true }).hover()
    await expect(page.getByRole('menuitemradio', { name: 'Manual', exact: true })).toBeChecked()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page.reload()
    await expect(source).toBeVisible()
    await expect(target).toBeVisible()
    await expect.poll(isAfter).toBe(after)
    await expect(editor).toHaveText('Keep the draft through sidebar gestures')
  })
}

for (const cancellation of ['Escape', 'pointercancel', 'outside', 'source removed']) {
  test(`cancelling a title reorder with ${cancellation} keeps the order and draft`, async ({ page }) => {
    const { moves, editor } = await openSidebar(page)
    const { source, target, after } = await aimOrder(page)
    if (cancellation === 'Escape') await page.keyboard.press('Escape')
    else if (cancellation === 'pointercancel') await source.dispatchEvent('pointercancel', { pointerId: 1, bubbles: true })
    else if (cancellation === 'outside') await page.mouse.move(1200, 500)
    else await source.evaluate(element => element.remove())
    await page.mouse.up()
    if (cancellation !== 'source removed') {
      await expect.poll(async () => (await source.boundingBox()).y > (await target.boundingBox()).y).toBe(!after)
    }
    await expect(page.locator('[data-session-moving], [data-session-order-drop]')).toHaveCount(0)
    expect(moves).toEqual([])
    await expect(page).toHaveURL(/#\/preview-week$/)
    await expect(editor).toHaveText('Keep the draft through sidebar gestures')
  })
}

for (const ordering of ['Updated', 'Created', 'Status', 'Tokens', 'Cost', 'Manual']) for (const handle of [false, true]) {
  test(`${handle ? 'handle' : 'title'} drops override ${ordering} ordering across dates`, async ({ page }) => {
    const old = app.gateway.sessions.get('preview-idea')
    const original = { ...old }
    Object.assign(old, { started_at: old.started_at - 86400 * 4, last_active: old.last_active - 86400 * 4,
      input_tokens: 5000, output_tokens: 10000, actual_cost_usd: 2 })
    try {
      const { editor } = await openSidebar(page, { grouped: false, dateGrouping: true })
      await page.getByRole('button', { name: 'Filters', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Ordering', exact: true }).hover()
      await page.getByRole('menuitemradio', { name: ordering, exact: true }).click()
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      const { source, target, after } = await aimOrder(page, { handle })
      await page.mouse.up()
      await expect.poll(async () => (await source.boundingBox()).y > (await target.boundingBox()).y).toBe(after)
      await page.getByRole('button', { name: 'Filters', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Ordering', exact: true }).hover()
      await expect(page.getByRole('menuitemradio', { name: 'Manual', exact: true })).toBeChecked()
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await expect(editor).toHaveText('Keep the draft through sidebar gestures')
      await expect(page).toHaveURL(/#\/preview-week$/)
      await page.reload()
      await expect(source).toBeVisible()
      await expect(target).toBeVisible()
      await expect.poll(async () => (await source.boundingBox()).y > (await target.boundingBox()).y).toBe(after)
    } finally { app.gateway.sessions.set('preview-idea', original) }
  })
}
