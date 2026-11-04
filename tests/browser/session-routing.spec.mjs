import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

let app
// This suite supplies copied sessions through request interception; workers bypass it.
test.use({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' })
test.setTimeout(90000)
test.beforeAll(async () => { app = await createBuiltApplication() })
test.afterAll(async () => { await app?.close() })
const editor = page => page.locator('[contenteditable="true"]:visible').first()
const reference = page => page.locator('a[title="research/preview-idea"]').last()

async function copiedSessions(context) {
  const calls = [], writes = [], errors = [], base = app.gateway.sessions.get('preview-idea')
  const copies = Object.fromEntries(['default', 'research'].map(profile => [profile, {
    ...base, profile, title: `${profile} copy`, unread: true, pinned: false, archived: false, prompts: []
  }]))
  let heldWrite
  const transcript = profile => [
    { id: `copy-${profile}-user`, role: 'user', content: 'Copied request', timestamp: 1900000000 },
    { id: `copy-${profile}-reply`, role: 'assistant', content: `${profile} copied transcript`, timestamp: 1900000001 }
  ]
  const update = (messages, id, profile) => {
    if (id === 'preview-idea') return transcript(profile)
    if (id === 'preview-week') {
      const user = messages?.find(row => row.role === 'user'), assistant = messages?.findLast(row => row.role === 'assistant')
      if (user) user.content = 'User reference: @session:research/preview-idea'
      if (assistant) assistant.content = 'Copied session: @session:research/preview-idea'
    }
    return messages
  }
  const observe = page => page.on('pageerror', error => errors.push(error.message))
  context.pages().forEach(observe)
  context.on('page', observe)
  await context.addInitScript(() => {
    // New popup documents briefly have an opaque origin before navigation.
    try { localStorage.setItem('hermes-web.browser.hermes.desktop.sidebarGrouping.allProfiles', 'none') } catch {}
  })
  await context.route('**/api/athena/preferences', route => route.abort())
  await context.route(/\/api\/(?:profiles\/)?sessions(?:\?|$)/, async route => {
    const response = await route.fetch(), body = await response.json(), url = new URL(route.request().url())
    const scope = url.pathname.includes('/profiles/') ? 'all' : url.searchParams.get('profile') || 'default'
    body.sessions = body.sessions.filter(row => row.id !== 'preview-idea')
    body.sessions.push(...Object.values(copies).filter(row => (scope === 'all' || scope === row.profile) && !row.archived))
    await route.fulfill({ response, json: body })
  })
  await context.route(/\/api\/profiles\/sessions\/sidebar(?:\?|$)/, async route => {
    const response = await route.fetch(), body = await response.json(), scope = new URL(route.request().url()).searchParams.get('recents_profile') || 'all'
    body.recents.sessions = body.recents.sessions.filter(row => row.id !== 'preview-idea')
    body.recents.sessions.push(...Object.values(copies).filter(row => (scope === 'all' || scope === row.profile) && !row.archived))
    await route.fulfill({ response, json: body })
  })
  await context.route(/\/api\/sessions\/preview-(week|idea)(?:\/messages)?(?:\?|$)/, async route => {
    const request = route.request(), url = new URL(request.url()), profile = url.searchParams.get('profile') || 'default'
    const id = url.pathname.includes('preview-week') ? 'preview-week' : 'preview-idea'
    if (id === 'preview-idea' && ['PATCH', 'DELETE'].includes(request.method())) {
      const body = request.postDataJSON() || {}, targetProfile = body.profile || profile
      const record = { profile: targetProfile, method: request.method(), body }
      writes.push(record)
      if (heldWrite && body.archived === true) { const hold = heldWrite; heldWrite = null; hold.entered(record); await hold.waiting }
      Object.assign(copies[targetProfile], body, request.method() === 'DELETE' ? { archived: true } : {})
      return route.fulfill({ json: { ok: true, ...body } })
    }
    const response = await route.fetch(), body = await response.json()
    if (url.pathname.endsWith('/messages')) body.messages = update(body.messages, id, profile)
    else if (id === 'preview-idea') Object.assign(body, copies[profile])
    await route.fulfill({ response, json: body })
  })
  await context.routeWebSocket(/\/api\/ws/, socket => {
    const server = socket.connectToServer(), requests = new Map(), socketProfile = new URL(socket.url()).searchParams.get('profile') || 'default'
    socket.onMessage(message => {
      const frame = JSON.parse(String(message)), profile = frame.params?.profile || socketProfile
      requests.set(frame.id, { ...frame, profile })
      calls.push({ method: frame.method, profile, params: frame.params })
      const reply = result => socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }))
      if (frame.params?.session_id === 'preview-idea' && ['session.title', 'session.rename'].includes(frame.method)) {
        copies[profile].title = frame.params.title
        return reply({ ok: true, title: frame.params.title })
      }
      if (frame.params?.session_id === 'preview-idea' && frame.method === 'prompt.submit') {
        copies[profile].prompts.push(frame.params.text)
        reply({ status: 'complete', submission_id: frame.params.submission_id })
        socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: {
          type: 'message.complete', session_id: 'preview-idea', profile,
          payload: { text: `Reply from ${profile}`, status: 'complete' }, timestamp: Date.now()
        } }))
        return
      }
      server.send(message)
    })
    server.onMessage(message => {
      const frame = JSON.parse(String(message)), request = requests.get(frame.id), id = request?.params?.session_id
      if (request?.method === 'session.list' && frame.result?.sessions) {
        const scope = request.params.profile || 'all'
        frame.result.sessions = frame.result.sessions.filter(row => row.id !== 'preview-idea')
        frame.result.sessions.push(...Object.values(copies).filter(row => (scope === 'all' || scope === row.profile) && !row.archived))
      }
      if (frame.result?.messages) frame.result.messages = update(frame.result.messages, id, request.profile)
      if (id === 'preview-idea' && frame.result?.info) frame.result.info.profile = request.profile
      socket.send(JSON.stringify(frame))
    })
  })
  return {
    calls, writes, copies, errors,
    holdWrite() {
      let entered, release
      const waiting = new Promise(resolve => { release = resolve })
      const observed = new Promise(resolve => { entered = resolve })
      heldWrite = { entered, waiting }
      return { entered: observed, release }
    }
  }
}

async function openReferences(page) {
  await page.goto(`${app.origin}/#/preview-week`)
  await expect(reference(page)).toBeVisible()
  await expect(page.locator('.athena-connecting-overlay')).toBeHidden()
  await editor(page).fill('Keep the original reference draft')
}
async function openCopy(page, gesture = 'click', link = reference(page)) {
  await page.bringToFront()
  const href = await link.getAttribute('href'), opened = page.waitForEvent('popup', { timeout: 15000 })
  if (gesture === 'keyboard') {
    // The renderer admits transcript focus during a Tab gesture, before keyup.
    await page.keyboard.down('Tab')
    await link.focus()
    await page.keyboard.up('Tab')
    await expect(link).toBeFocused()
    await link.press('Enter')
  }
  else if (gesture === 'context') {
    await link.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Open in browser tab', exact: true }).click()
  } else await link.click(gesture === 'middle' ? { button: 'middle' } : gesture === 'modifier' ? { modifiers: ['ControlOrMeta'] } : {})
  const popup = await opened
  await expect(popup).toHaveURL(href)
  await expect(popup.getByText('research copied transcript', { exact: true })).toBeVisible()
  await expect(popup.locator('.athena-connecting-overlay')).toBeHidden()
  expect(new URL(popup.url()).hash).toBe('#/preview-idea?profile=research')
  expect(await popup.evaluate(() => window.opener)).toBeNull()
  return popup
}
async function action(page, name) {
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await page.getByRole('menuitem', { name }).click()
}

test('native session-reference gestures retain explicit copied-session ownership', async ({ page, context, browserName }) => {
  const backend = await copiedSessions(context)
  await openReferences(page)
  const links = page.locator('a[title="research/preview-idea"]')
  await expect(links).toHaveCount(2)
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await reference(page).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Copy URL', exact: true }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(await reference(page).getAttribute('href'))
  }
  for (const gesture of ['keyboard', 'click', 'modifier', 'middle', 'context']) {
    const popup = await openCopy(page, gesture, gesture === 'click' ? links.first() : links.last())
    await popup.close()
    await expect(page).toHaveURL(`${app.origin}/#/preview-week`)
    await expect(editor(page)).toHaveText('Keep the original reference draft')
  }
  const resumes = backend.calls.filter(call => call.method === 'session.resume' && call.params.session_id === 'preview-idea')
  expect(resumes.length).toBeGreaterThanOrEqual(5)
  expect(resumes.every(call => call.profile === 'research')).toBe(true)
  expect(backend.errors).toEqual([])
})

test('owned session references preserve copied ids through sends and toolbar writes', async ({ page, context }) => {
  const backend = await copiedSessions(context)
  await openReferences(page)
  const popup = await openCopy(page)
  await editor(popup).fill('Question for the research copy')
  await editor(popup).press('Enter')
  await expect.poll(() => backend.copies.research.prompts).toEqual(['Question for the research copy'])
  expect(backend.copies.default.prompts).toEqual([])
  await action(popup, /^Rename/)
  const dialog = popup.getByRole('dialog').last()
  await expect(dialog.getByRole('textbox')).toHaveValue('research copy')
  await dialog.getByRole('textbox').fill('Research copy renamed')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(backend.copies.research.title).toBe('Research copy renamed')
  expect(backend.copies.default.title).toBe('default copy')
  await expect.poll(() => backend.copies.research.unread).toBe(false)
  expect(backend.copies.default.unread).toBe(true)
  await action(popup, /^Mark as unread/)
  await expect.poll(() => backend.copies.research.unread).toBe(true)
  await action(popup, /^Pin(?:\s|$)/)
  await expect.poll(() => backend.copies.research.pinned).toBe(true)
  expect(backend.copies.default.pinned).toBe(false)
  await popup.close()
  expect(backend.errors).toEqual([])
})

test('owned routes survive profile filtering and browser history', async ({ page, context }) => {
  const backend = await copiedSessions(context)
  await openReferences(page)
  const popup = await openCopy(page)
  await editor(popup).fill('Research copy draft')
  const configured = Promise.all(['/api/config', '/api/config/defaults'].map(path => popup.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === path && url.searchParams.get('profile') === 'writer'
  }).then(response => response.finished())))
  await popup.locator('[data-profile-key="writer"]').click()
  await configured
  await popup.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect.poll(() => new URL(popup.url()).searchParams.get('profile')).toBe('writer')
  await popup.reload()
  await expect(popup.getByText('research copied transcript', { exact: true })).toBeVisible()
  await expect(editor(popup)).toHaveText('Research copy draft')
  expect(new URL(popup.url()).searchParams.get('profile')).toBe('writer')
  expect((await popup.evaluate(() => window.hermesDesktop.getConnection())).profile).toBe('writer')
  await popup.getByRole('button', { name: 'All profiles', exact: true }).click()
  await popup.getByRole('button', { name: 'Plan a calmer working week', exact: true }).click()
  await expect(popup).toHaveURL(/#\/preview-week$/)
  await editor(popup).fill('Other conversation draft')
  await popup.goBack()
  await expect(popup.getByText('research copied transcript', { exact: true })).toBeVisible()
  await expect(editor(popup)).toHaveText('Research copy draft')
  await popup.goForward()
  await expect(editor(popup)).toHaveText('Other conversation draft')
  await popup.close()
  expect(backend.errors).toEqual([])
})

test('a late archive of one copy preserves a newer selection of the other profile', async ({ page, context }) => {
  const backend = await copiedSessions(context)
  await openReferences(page)
  const popup = await openCopy(page), archive = backend.holdWrite()
  await action(popup, /^Archive/)
  const write = await archive.entered
  expect(write.profile).toBe('research')
  expect(write.body.archived).toBe(true)
  await popup.evaluate(() => { window.location.hash = '/preview-idea?profile=default' })
  await expect(popup.getByText('default copied transcript', { exact: true })).toBeVisible()
  await editor(popup).fill('Keep the default copy draft')
  archive.release()
  await expect.poll(() => backend.copies.research.archived).toBe(true)
  expect(backend.copies.default.archived).toBe(false)
  await expect(popup).toHaveURL(/#\/preview-idea\?profile=default$/)
  await expect(editor(popup)).toHaveText('Keep the default copy draft')
  await expect(popup.locator('[data-web-session-id="preview-idea"][data-web-session-profile="default"]')).toBeVisible()
  await popup.close()
  expect(backend.errors).toEqual([])
})

test('a background copied row cannot rename the selected profile runtime', async ({ page, context }) => {
  const backend = await copiedSessions(context)
  await openReferences(page)
  const popup = await openCopy(page)
  await popup.locator('[data-web-session-id="preview-idea"][data-web-session-profile="default"]').click({ button: 'right' })
  await popup.getByRole('menuitem', { name: /^Rename/ }).click()
  const dialog = popup.getByRole('dialog').last()
  await dialog.getByRole('textbox').fill('Default copy renamed')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => backend.copies.default.title).toBe('Default copy renamed')
  expect(backend.copies.research.title).toBe('research copy')
  await action(popup, /^Rename/)
  await expect(popup.getByRole('dialog').last().getByRole('textbox')).toHaveValue('research copy')
  await popup.getByRole('dialog').last().getByRole('button', { name: 'Cancel', exact: true }).click()
  await popup.close()
  expect(backend.errors).toEqual([])
})

test('deleting an owned copy preserves its sibling profile', async ({ page, context }) => {
  const backend = await copiedSessions(context)
  await openReferences(page)
  const popup = await openCopy(page)
  await action(popup, /^Delete/)
  const dialog = popup.getByRole('dialog').last()
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.poll(() => backend.copies.research.archived).toBe(true)
  expect(backend.writes.some(write => write.method === 'DELETE' && write.profile === 'research')).toBe(true)
  expect(backend.copies.default.archived).toBe(false)
  await expect(popup.locator('[data-web-session-id="preview-idea"][data-web-session-profile="default"]')).toBeVisible()
  await popup.close()
  expect(backend.errors).toEqual([])
})
