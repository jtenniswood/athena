import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const compiled = ts.transpileModule(readFileSync('apps/web-desktop/src/upstream/native-settings.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
async function fixture(page, supported = true) {
  await page.setContent(`<div class="browser-settings-fullscreen-card"><button aria-label="Close settings" id="close">Close</button>
    <div data-browser-settings-frame><header class="browser-settings-header"><h1>Settings</h1>
    <div class="browser-settings-search"><button aria-label="Search settings" id="search">Search</button></div></header>
    <nav><h2>Preferences</h2><button id="appearance">Appearance</button></nav>
    <label>Display name<input id="name" value="Original"></label>
    <label>API secret<input id="secret" type="password" value="never-copy-this-secret"></label>
    <label>Notifications<input id="toggle" type="checkbox"></label>
    <label>Theme<select id="theme"><option value="light">Light</option><option value="dark">Dark</option><option disabled value="blocked">Blocked</option></select></label>
    <button id="disabled" disabled>Disabled action</button><button id="confirm">Reset settings</button>
    <button id="pick" data-slot="select-trigger" role="combobox" aria-label="Model">Current model</button>
    <div id="status" role="status"></div></div></div>`)
  await page.evaluate(({ compiled, supported }) => {
    window.models = []; window.events = []; window.dropped = []
    document.getElementById('name').onchange = event => window.events.push(['change', event.target.value])
    document.getElementById('name').onblur = event => window.events.push(['save', event.target.value])
    document.getElementById('toggle').onchange = event => window.events.push(['toggle', event.target.checked])
    document.getElementById('theme').onchange = event => window.events.push(['theme', event.target.value])
    document.getElementById('appearance').onclick = () => window.events.push(['page', 'appearance'])
    document.getElementById('disabled').onclick = () => window.events.push(['disabled'])
    document.getElementById('close').onclick = () => document.querySelector('[data-browser-settings-frame]').remove()
    document.getElementById('confirm').onclick = () => {
      const dialog = document.createElement('section'); dialog.setAttribute('role','alertdialog'); dialog.setAttribute('aria-label','Confirm reset')
      dialog.innerHTML = '<p>Reset this configuration?</p><button id="cancel">Cancel</button><button id="reset">Reset</button>'
      document.body.append(dialog)
      document.getElementById('cancel').onclick = () => dialog.remove()
      document.getElementById('reset').onclick = () => { window.events.push(['reset']); dialog.remove() }
    }
    document.getElementById('pick').onkeydown = event => {
      if(event.key !== 'ArrowDown') return
      const list = document.createElement('div'); list.setAttribute('role','listbox'); list.setAttribute('aria-label','Models')
      list.innerHTML = '<button role="option">Native model choice</button>'
      list.firstChild.onclick = () => { window.events.push(['model']); list.remove() }
      document.body.append(list)
    }
    const exports = {}
    const api = {
      isAndroidApp: () => true, androidHost: async () => ({ capabilities: supported ? ['settings-page'] : [] }),
      androidOpenSettingsPage: (model, callback) => {
        window.models.push(model); window.nativeChange = callback; callback('ready')
        return new Promise(resolve => { window.finish = resolve })
      },
      androidUpdateSettingsPage: async model => { window.models.push(model); return true },
      androidSettingsFiles: async () => [{ name: 'settings.json', type: 'application/json', data: btoa('{"model":"imported"}') }],
      androidDismissSettingsPage: async id => { window.dropped.push(id); window.finish?.() }
    }
    new Function('exports','require',compiled)(exports, () => api)
    window.stopSettings = exports.installNativeSettings()
  }, { compiled, supported })
  if (supported) await expect.poll(() => page.evaluate(() => window.models.length)).toBeGreaterThan(0)
}
async function activate(page, label, value) {
  await page.evaluate(({ label, value }) => {
    const row = window.models.at(-1).rows.find(row => row.label === label)
    if (!row) throw new Error('Missing native row: '+label)
    window.nativeChange(row.id, value)
  }, { label, value })
}

test('native edits use original change and blur/save handlers and never snapshot masked secrets', async ({ page }) => {
  await fixture(page)
  expect(await page.evaluate(() => JSON.stringify(window.models))).not.toContain('never-copy-this-secret')
  await activate(page,'Display name','Updated value')
  await expect.poll(() => page.evaluate(() => window.events)).toEqual([['change','Updated value'],['save','Updated value']])
  await expect.poll(() => page.evaluate(() => window.models.at(-1).rows.find(row=>row.label==='Display name').value)).toBe('Updated value')
})
test('native toggles, choices and navigation use existing controls and reject disabled choices', async ({ page }) => {
  await fixture(page)
  await activate(page,'Notifications')
  await activate(page,'Theme','dark')
  await activate(page,'Theme','blocked')
  await activate(page,'Appearance')
  await activate(page,'Disabled action')
  await expect.poll(() => page.evaluate(() => window.events)).toEqual([['toggle',true],['theme','dark'],['page','appearance']])
})
test('native select triggers open the original picker and execute its option', async ({ page }) => {
  await fixture(page)
  await activate(page,'Model')
  await expect.poll(() => page.evaluate(() => window.models.at(-1).title)).toBe('Models')
  await activate(page,'Native model choice')
  await expect.poll(() => page.evaluate(() => window.events)).toEqual([['model']])
  await expect.poll(() => page.evaluate(() => window.models.at(-1).title)).toBe('Settings')
})
test('destructive actions retain their original confirmation and errors remain visible', async ({ page }) => {
  await fixture(page)
  await activate(page,'Reset settings')
  await expect.poll(() => page.evaluate(() => window.models.at(-1).title)).toBe('Confirm reset')
  expect(await page.evaluate(() => window.events)).toEqual([])
  await activate(page,'Cancel')
  await expect.poll(() => page.evaluate(() => window.models.at(-1).title)).toBe('Settings')
  await page.evaluate(() => document.getElementById('status').textContent = 'The server could not save this value.')
  await expect.poll(() => page.evaluate(() => window.models.at(-1).rows.some(row=>row.label==='The server could not save this value.'))).toBe(true)
})
test('removed fields and stale page commands cannot modify another setting', async ({ page }) => {
  await fixture(page)
  const id = await page.evaluate(() => window.models.at(-1).rows.find(row=>row.label==='Display name').id)
  await page.evaluate(id => { document.getElementById('name').remove(); window.nativeChange(id,'Wrong value') },id)
  expect(await page.evaluate(() => window.events)).toEqual([])
  await page.evaluate(() => window.nativeChange('close'))
  await expect.poll(() => page.evaluate(() => window.dropped.length)).toBeGreaterThan(0)
})
test('older APKs retain the ordinary web settings page', async ({ page }) => {
  await fixture(page, false)
  await page.evaluate(() => new Promise(requestAnimationFrame))
  expect(await page.evaluate(() => window.models.length)).toBe(0)
  await expect(page.locator('[data-browser-settings-frame]')).not.toHaveAttribute('data-native-settings')
})

test('native document imports reach the original file input change handler', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => {
    const root = document.querySelector('[data-browser-settings-frame]')
    const file = document.createElement('input'); file.type = 'file'; file.hidden = true
    file.onchange = async () => window.events.push(['import', file.files[0].name, await file.files[0].text()])
    const button = document.createElement('button'); button.textContent = 'Import configuration'; button.onclick = () => file.click()
    root.append(file, button)
  })
  await expect.poll(() => page.evaluate(() => window.models.at(-1).rows.some(row => row.label === 'Import configuration'))).toBe(true)
  await activate(page, 'Import configuration')
  await expect.poll(() => page.evaluate(() => window.events)).toEqual([['import','settings.json','{"model":"imported"}']])
})

test('segmented choices retain their own labels within a setting field', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => {
    const group = document.createElement('div'); group.id = 'setting-field-embeds'
    group.innerHTML = '<div class="font-medium"><span>Inline Embeds</span></div><button aria-pressed="true">Ask</button><button aria-pressed="false">Always</button><button aria-pressed="false">Off</button>'
    document.querySelector('[data-browser-settings-frame]').append(group)
  })
  await expect.poll(() => page.evaluate(() => window.models.at(-1).rows.filter(row => ['Ask','Always','Off'].includes(row.label)).map(row => [row.label,row.checked]))).toEqual([['Ask',true],['Always',false],['Off',false]])
})
