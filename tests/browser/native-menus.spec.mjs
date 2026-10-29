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
    window.nativeSelect = (status, id, value) => respond(openRequest, { status, id, value })
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
      sub.innerHTML = '<button aria-label="hsl(240 68% 58%)" style="background-color:hsl(240 68% 58%)" id="blue"></button>'
      sub.onkeydown = event => { if (event.key === 'ArrowLeft') sub.remove() }
      document.body.append(sub)
      document.getElementById('blue').onclick = event => {
        window.selections.push('blue'); event.currentTarget.style.boxShadow = '0 0 0 2px currentColor'
      }
    }
    window.startNativeMenus = supported => menus.installNativeRendererMenus(supported)
    window.stopNativeMenus = window.startNativeMenus(false)
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
  await expect.poll(() => page.evaluate(() => window.calls.filter(call => call.method === 'updateActionMenu').at(-1).payload.groups[0].items[0].checked)).toBe(true)
  const swatch = await page.evaluate(() => window.calls.filter(call => call.method === 'updateActionMenu').at(-1).payload.groups[0].items[0])
  expect(swatch.label).toBe('Blue')
  expect(swatch.color).toMatch(/^#[a-f0-9]{6}$/)
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

async function modelFixture(page, supported = true) {
  await page.evaluate(supported => {
    window.stopNativeMenus(); window.calls = []; window.selections = []
    document.body.innerHTML = `<button id="model-trigger" aria-label="Switch model"></button>
      <div id="model-menu" data-slot="dropdown-menu-content" data-state="open" aria-labelledby="model-trigger" role="menu">
      <div data-slot="dropdown-menu-search"><input aria-label="Search models" placeholder="Search models"></div>
      <div id="models"></div></div>`
    const root = document.getElementById('model-menu')
    root.onkeydown = event => { if (event.key === 'Escape') root.remove() }
    const render = query => {
      const list = document.getElementById('models'); list.replaceChildren()
      for(let index=0;index<40;index++) {
        const name = 'Model '+index
        if (!name.toLowerCase().includes(query.toLowerCase())) continue
        const row = document.createElement('div'); row.id = 'model-'+index; row.role='menuitem'
        row.dataset.slot='dropdown-menu-sub-trigger'; row.setAttribute('aria-haspopup','menu')
        row.innerHTML = `<button aria-label="Favorite ${name}" aria-pressed="false"></button><span>${name}</span>${index===0?'<i class="codicon-check" aria-hidden="true"></i>':''}`
        row.onclick = () => { window.selections.push(name); root.remove() }
        row.firstChild.onclick = event => { event.stopPropagation(); event.target.setAttribute('aria-pressed','true'); window.selections.push('favorite '+name) }
        row.onkeydown = event => {
          if (event.key !== 'ArrowRight') return
          const sub = document.createElement('div'); sub.dataset.slot='dropdown-menu-sub-content';sub.dataset.state='open';sub.setAttribute('aria-labelledby',row.id)
          sub.innerHTML='<div role="menuitem">Thinking<button role="switch" aria-checked="false"></button></div>'
          sub.firstChild.firstElementChild.onclick = event => { event.target.setAttribute('aria-checked','true'); window.selections.push('thinking') }
          sub.onkeydown = event => { if (event.key === 'ArrowLeft') sub.remove() }
          document.body.append(sub)
        }
        list.append(row)
      }
    }
    root.querySelector('input').oninput = event => render(event.target.value)
    render('')
    const refresh = document.createElement('div'); refresh.role='menuitem'; refresh.textContent='Refresh models'
    refresh.onclick=()=>window.selections.push('refresh')
    root.append(refresh)
    window.stopNativeMenus = window.startNativeMenus(supported)
  }, supported)
}

test('native model search filters through the original input and chooses the original model', async ({ page }) => {
  await modelFixture(page)
  let menu = await page.evaluate(() => window.calls.at(-1).payload)
  expect(menu.search.label).toBe('Search models')
  expect(items(menu).find(item => item.label === 'Model 0').checked).toBe(true)
  await page.evaluate(() => window.nativeSelect('changed','search', 'Model 39'))
  await expect.poll(()=>page.evaluate(()=>window.calls.at(-1).payload.groups.flatMap(group=>group.items).filter(item=>item.label.startsWith('Model ')).map(item=>item.label))).toEqual(['Model 39'])
  await select(page,'Model 39')
  await expect.poll(()=>page.evaluate(()=>window.selections)).toEqual(['Model 39'])
})

test('native model catalogs page through every row within the menu envelope', async ({ page }) => {
  await modelFixture(page)
  const names = new Set()
  for (let index=0;index<3;index++) {
    const menu = await page.evaluate(() => window.calls.filter(call=>['actionMenu','updateActionMenu'].includes(call.method)).at(-1).payload)
    expect(JSON.stringify(menu).length).toBeLessThan(14000)
    items(menu).filter(item=>item.label.startsWith('Model ')).forEach(item=>names.add(item.label))
    if(index<2) await select(page,'Next page')
  }
  expect(names.size).toBe(40)
})

test('native model details retain favorites, options and working nested switches', async ({ page }) => {
  await modelFixture(page)
  const model = await page.evaluate(() => window.calls.at(-1).payload.groups.flatMap(group=>group.items).find(item=>item.label==='Model 0'))
  expect(model.selectable).toBe(true)
  await page.evaluate(id=>window.nativeSelect('changed',id),model.children[0].items[0].id)
  await expect.poll(()=>page.evaluate(()=>window.selections)).toEqual(['favorite Model 0'])
  await page.evaluate(id=>window.nativeSelect('changed',id),model.children[0].items[1].id)
  await expect.poll(()=>page.evaluate(()=>window.calls.at(-1).payload.backId)).toBe('back')
  await select(page,'Thinking')
  await expect.poll(()=>page.evaluate(()=>window.selections)).toEqual(['favorite Model 0','thinking'])
  await select(page,'back')
  await expect.poll(()=>page.evaluate(()=>window.calls.at(-1).payload.search?.id)).toBe('search')
})

test('older APKs keep searchable model menus on the web', async ({ page }) => {
  await modelFixture(page,false)
  expect(await page.evaluate(()=>window.calls.filter(call=>call.method==='actionMenu').length)).toBe(0)
  await expect(page.locator('#model-menu')).not.toHaveAttribute('data-native-menu')
})

test('native refresh preserves the original model menu instead of dismissing it', async ({ page }) => {
  await modelFixture(page)
  await select(page,'Next page'); await select(page,'Next page')
  const refresh = await page.evaluate(()=>window.calls.at(-1).payload.groups.flatMap(group=>group.items).find(item=>item.label==='Refresh models'))
  expect(refresh.keepOpen).toBe(true)
  await select(page,'Refresh models')
  await expect(page.locator('#model-menu')).toHaveCount(1)
  expect(await page.evaluate(()=>window.selections)).toEqual(['refresh'])
})

test('Settings menus stay on the web and chat menus return to Android after closing Settings', async ({ page }) => {
  await page.evaluate(() => {
    window.stopNativeMenus()
    const settings = document.createElement('div')
    settings.setAttribute('data-browser-settings-frame', '')
    document.body.append(settings)
    document.getElementById('trigger').setAttribute('aria-label', 'Settings actions')
    window.calls = []
    window.stopNativeMenus = window.startNativeMenus(false)
  })
  await expect(page.locator('#menu')).not.toHaveAttribute('data-native-menu')
  await page.locator('#pin').click()
  expect(await page.evaluate(() => window.selections)).toEqual(['pin'])
  expect(await page.evaluate(() => window.calls.filter(call => call.method === 'actionMenu'))).toEqual([])
  await page.evaluate(() => {
    document.querySelector('[data-browser-settings-frame]').remove()
    document.getElementById('trigger').setAttribute('aria-label', 'Chat actions')
  })
  await expect.poll(() => page.evaluate(() => window.calls.filter(call => call.method === 'actionMenu').length)).toBe(1)
  expect(await page.evaluate(() => window.calls.find(call => call.method === 'actionMenu').payload.title)).toBe('Chat actions')
  await expect(page.locator('#menu')).toHaveAttribute('data-native-menu', '')
})
