import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const compile = file => ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const bridge = compile('apps/web-desktop/src/platform/android.ts')
const adapter = compile('apps/web-desktop/src/upstream/native-renderer-menus.ts')

test.beforeEach(async ({ page }) => {
  await page.setContent(`<button id="trigger" aria-label="Chat actions" aria-controls="menu">…</button>
    <div id="menu" data-slot="dropdown-menu-content" data-state="open" aria-labelledby="trigger" role="menu">
      <div role="menuitem" id="rename">Rename</div>
      <div role="menuitemcheckbox" aria-checked="false" id="pin">Pinned</div>
      <div role="menuitem" aria-disabled="true" data-variant="destructive" id="delete">Delete</div>
      <div role="menuitem" id="appearance" data-slot="dropdown-menu-sub-trigger" aria-haspopup="menu">Appearance</div>
    </div>`)
  await page.evaluate(({ bridge, adapter }) => {
    window.calls = []
    window.selections = []
    let openRequest
    const respond = (id, value) => window.AthenaAndroid.onmessage({ data: JSON.stringify({ id, value }) })
    window.AthenaAndroid = { postMessage(raw) {
      const request = JSON.parse(raw)
      window.calls.push(request)
      if (request.method === 'actionMenu') openRequest = request.id
      else if (request.method === 'dismissActionMenu') {
        respond(openRequest, { status: 'dismissed' }); respond(request.id, true)
      } else respond(request.id, true)
    } }
    window.nativeSelect = (status, id) => respond(openRequest, { status, id })
    const platform = {}
    new Function('exports', bridge)(platform)
    const menus = {}
    new Function('exports', 'require', adapter)(menus, () => platform)
    const root = document.getElementById('menu')
    root.addEventListener('keydown', event => { if (event.key === 'Escape') root.remove() })
    document.getElementById('rename').onclick = () => { window.selections.push('rename'); root.remove() }
    document.getElementById('delete').onclick = () => { window.selections.push('delete') }
    document.getElementById('pin').onclick = event => {
      const row = event.currentTarget
      row.setAttribute('aria-checked', String(row.getAttribute('aria-checked') !== 'true'))
      window.selections.push('pin')
    }
    document.getElementById('appearance').onclick = () => {
      const sub = document.createElement('div')
      sub.id = 'submenu'; sub.dataset.slot = 'dropdown-menu-sub-content'; sub.dataset.state = 'open'
      sub.setAttribute('aria-labelledby', 'appearance')
      sub.innerHTML = '<button aria-label="Blue" id="blue">Blue</button>'
      sub.onkeydown = event => { if (event.key === 'ArrowLeft') sub.remove() }
      document.body.append(sub)
      document.getElementById('blue').onclick = () => { window.selections.push('blue') }
    }
    window.stopNativeMenus = menus.installNativeRendererMenus()
  }, { bridge, adapter })
})

const items = menu => menu.groups.flatMap(group => group.items)
async function select(page, label, status = 'changed') {
  await page.evaluate(({ label, status }) => {
    const latest = window.calls.filter(call => ['actionMenu', 'updateActionMenu'].includes(call.method)).at(-1).payload
    const id = label === 'back' ? 'back' : latest.groups.flatMap(group => group.items).find(item => item.label === label).id
    window.nativeSelect(status, id)
  }, { label, status })
}

test('chat row commands use a native sheet and retain disabled and destructive semantics', async ({ page }) => {
  const menu = await page.evaluate(() => window.calls.find(call => call.method === 'actionMenu').payload)
  expect(menu.title).toBe('Chat actions')
  expect(menu.compact).toBe(true)
  expect(items(menu).find(item => item.label === 'Delete').disabled).toBe(true)
  expect(items(menu).find(item => item.label === 'Delete').destructive).toBe(true)
  await select(page, 'Delete')
  expect(await page.evaluate(() => window.selections)).toEqual([])
  await select(page, 'Rename', 'selected')
  await expect(page.locator('#menu')).toHaveCount(0)
  expect(await page.evaluate(() => window.selections)).toEqual(['rename'])
})

test('native checkbox selections update the current sheet without another open request', async ({ page }) => {
  await select(page, 'Pinned')
  await expect.poll(() => page.evaluate(() => window.calls.filter(call => call.method === 'updateActionMenu').length)).toBe(1)
  const calls = await page.evaluate(() => window.calls)
  expect(calls.filter(call => call.method === 'actionMenu')).toHaveLength(1)
  const update = calls.find(call => call.method === 'updateActionMenu').payload
  expect(update.id).toBe(calls[0].payload.id)
  expect(items(update).find(item => item.label === 'Pinned').checked).toBe(true)
  await expect(page.locator('#menu')).toHaveAttribute('data-native-menu', '')
  await select(page, 'Pinned')
  await expect(page.locator('#pin')).toHaveAttribute('aria-checked', 'false')
})

test('renderer submenus and back navigation update the same native modal', async ({ page }) => {
  await select(page, 'Appearance')
  await expect.poll(() => page.evaluate(() => window.calls.at(-1).payload.backId)).toBe('back')
  await select(page, 'Blue')
  expect(await page.evaluate(() => window.selections)).toEqual(['blue'])
  await select(page, 'back')
  await expect(page.locator('#submenu')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.calls.filter(call => call.method === 'updateActionMenu').at(-1).payload.title)).toBe('Chat actions')
  expect(await page.evaluate(() => window.calls.filter(call => call.method === 'actionMenu').length)).toBe(1)
  await page.evaluate(() => window.nativeSelect('dismissed'))
  await expect(page.locator('#menu')).toHaveCount(0)
})

test('native menus reject removed commands and restore the web menu when unavailable', async ({ page }) => {
  await page.locator('#rename').evaluate(node => node.remove())
  await page.evaluate(() => window.nativeSelect('changed', 'item-1'))
  expect(await page.evaluate(() => window.selections)).toEqual([])
  // Unknown native responses use the adapter's unavailable fallback.
  await page.evaluate(() => window.nativeSelect('unavailable'))
  await expect(page.locator('#menu')).not.toHaveAttribute('data-native-menu', '')
  await expect(page.locator('#menu')).toHaveCount(1)
  await page.locator('#pin').evaluate(node => node.setAttribute('aria-checked', 'true'))
  expect(await page.evaluate(() => window.calls.filter(call => call.method === 'actionMenu').length)).toBe(1)
})
