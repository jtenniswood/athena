import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const compiled = ts.transpileModule(readFileSync('apps/web-desktop/src/upstream/native-settings.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const presentation = ts.transpileModule(readFileSync('apps/web-desktop/src/platform/settings-presentation.ts', 'utf8'), {
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
  await page.evaluate(({ compiled, presentation, supported }) => {
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
      androidSettingsFiles: async () => window.pendingFiles || [{ name: 'settings.json', type: 'application/json', data: btoa('{"model":"imported"}') }],
      androidDismissSettingsPage: async id => { window.dropped.push(id); window.finish?.() }
    }
    const descriptors = {}
    new Function('exports', presentation)(descriptors)
    window.settingsDescriptors = descriptors
    new Function('exports','require',compiled)(exports, name => name.endsWith('/settings-presentation') ? descriptors : api)
    window.stopSettings = exports.installNativeSettings()
  }, { compiled, presentation, supported })
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

test('native presentation preserves field hierarchy, current values and exclusive choice ownership', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => {
    const section = document.createElement('section')
    section.innerHTML = `<div id="setting-field-scale"><div class="font-medium"><span>Interface scale</span></div>
      <div class="mt-1">Resize the interface.</div><div class="inline-grid">
      <button aria-pressed="false">90%</button><button aria-pressed="true">100%</button><button aria-pressed="false">125%</button></div></div>
      <div id="setting-field-language"><div class="font-medium"><span>Language</span></div>
      <div class="mt-1">Choose the interface language.</div><button aria-label="Switch language" aria-haspopup="dialog">English</button></div>
      <button data-variant="destructive">Delete configuration</button>
      <div><button aria-pressed="true">Independent option</button></div>`
    section.querySelectorAll('.inline-grid button').forEach(button => button.onclick = () => {
      section.querySelectorAll('.inline-grid button').forEach(item => item.setAttribute('aria-pressed',String(item === button)))
      window.events.push(['scale',button.textContent])
    })
    document.querySelector('[data-browser-settings-frame]').append(section)
  })
  await expect.poll(() => page.evaluate(() => window.models.at(-1).rows.some(row=>row.label==='Language'))).toBe(true)
  const rows = await page.evaluate(() => window.models.at(-1).rows)
  expect(rows.filter(row=>row.label==='Interface scale')).toEqual([{kind:'heading',label:'Interface scale'}])
  expect(rows.filter(row=>row.label==='Resize the interface.')).toHaveLength(1)
  const choices = rows.filter(row=>['90%','100%','125%'].includes(row.label))
  expect(new Set(choices.map(row=>row.group)).size).toBe(1)
  expect(choices[0].group).toBeTruthy()
  expect(choices.every(row=>row.kind==='action' && row.presentation==='choice')).toBe(true)
  expect(rows.find(row=>row.label==='Language')).toMatchObject({kind:'action',presentation:'value',value:'English',description:'Choose the interface language.'})
  expect(rows.find(row=>row.label==='Delete configuration').presentation).toBe('destructive')
  expect(rows.find(row=>row.label==='Independent option')).toMatchObject({kind:'toggle',checked:true})
  await activate(page,'125%')
  await expect.poll(() => page.evaluate(() => window.models.at(-1).rows.find(row=>row.label==='125%').checked)).toBe(true)
  expect(await page.evaluate(()=>window.events)).toEqual([['scale','125%']])
})

test('explicit settings models bypass HTML inference and refresh values without DOM mutations', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => {
    const api = window.settingsDescriptors
    window.ownedValue = 'Owner value'
    const input = document.getElementById('name')
    window.releaseDescriptor = api.registerSettingsDescriptor(input, api.createSettingsDescriptor(() => [{
      id: 'display', kind: 'input', label: 'Owned display name', value: window.ownedValue,
      run: value => { window.ownedValue = value; window.events.push(['owner', value]); api.settingsPresentationChanged() }
    }]))
  })
  await expect.poll(() => page.evaluate(() => window.models.at(-1).rows.some(row => row.label === 'Owned display name'))).toBe(true)
  await activate(page, 'Owned display name', 'Direct command')
  await expect.poll(() => page.evaluate(() => window.models.at(-1).rows.find(row => row.label === 'Owned display name').value)).toBe('Direct command')
  expect(await page.evaluate(() => window.events)).toEqual([['owner','Direct command']])
  expect(await page.locator('#name').inputValue()).toBe('Original')
})

test('explicit field commands cannot cross a profile or owner change, including before the next snapshot', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => {
    const api = window.settingsDescriptors, root = document.querySelector('[data-browser-settings-frame]')
    window.profile = 'A'
    api.registerSettingsFrame(root, () => ({ scope: window.profile, title: 'Owned settings', close() {}, back() {} }))
    const descriptor = api.createSettingsDescriptor(() => [{ id: 'name', kind: 'input', label: 'Owned field',
      run: value => window.events.push([window.profile, value]) }])
    window.releaseDescriptor = api.registerSettingsDescriptor(document.getElementById('name'), descriptor)
  })
  await expect.poll(() => page.evaluate(() => window.models.at(-1).title)).toBe('Owned settings')
  const oldId = await page.evaluate(() => window.models.at(-1).rows.find(row => row.label === 'Owned field').id)
  await page.evaluate(id => { window.profile = 'B'; window.nativeChange(id, 'Wrong profile'); window.settingsDescriptors.settingsPresentationChanged() }, oldId)
  await expect.poll(() => page.evaluate(() => window.models.at(-1).rows.find(row => row.label === 'Owned field').id)).not.toBe(oldId)
  expect(await page.evaluate(() => window.events)).toEqual([])
  await activate(page, 'Owned field', 'Correct profile')
  await expect.poll(() => page.evaluate(() => window.events)).toEqual([['B','Correct profile']])
  const currentId = await page.evaluate(() => window.models.at(-1).rows.find(row => row.label === 'Owned field').id)
  await page.evaluate(id => { window.releaseDescriptor(); window.nativeChange(id, 'Released owner') }, currentId)
  expect(await page.evaluate(() => window.events)).toEqual([['B','Correct profile']])
})

test('explicit commands preserve native file selection and discard a picker returned to another profile', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => {
    const api = window.settingsDescriptors, root = document.querySelector('[data-browser-settings-frame]')
    window.profile = 'A'
    api.registerSettingsFrame(root, () => ({ scope: window.profile, title: 'Owned import', close() {}, back() {} }))
    const button = document.createElement('button'), input = document.createElement('input')
    button.textContent = 'Unrelated HTML label'; input.type = 'file'; input.hidden = true
    input.onchange = async () => window.events.push(['import', input.files[0].name, await input.files[0].text()])
    root.append(button, input)
    api.registerSettingsDescriptor(button, api.createSettingsDescriptor(() => [{ id: 'import', kind: 'action',
      label: 'Owned import command', run: () => input.click() }]))
  })
  await expect.poll(() => page.evaluate(() => window.models.at(-1).rows.some(row => row.label === 'Owned import command'))).toBe(true)
  await activate(page, 'Owned import command')
  await expect.poll(() => page.evaluate(() => window.events)).toEqual([['import','settings.json','{"model":"imported"}']])
  await page.evaluate(() => { window.pendingFiles = new Promise(resolve => { window.finishFiles = resolve }) })
  await activate(page, 'Owned import command')
  await page.evaluate(() => {
    window.profile = 'B'
    window.settingsDescriptors.settingsPresentationChanged()
    window.finishFiles([{ name: 'wrong-profile.json', type: 'application/json', data: btoa('{}') }])
  })
  await page.evaluate(() => new Promise(requestAnimationFrame))
  expect(await page.evaluate(() => window.events)).toEqual([['import','settings.json','{"model":"imported"}']])
})

test('failed explicit saves remain visible and late failures do not affect a new settings scope', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => {
    const api = window.settingsDescriptors
    window.profile = 'A'
    api.registerSettingsFrame(document.querySelector('[data-browser-settings-frame]'), () => ({ scope: window.profile, title: 'Save owner', close() {}, back() {} }))
    api.registerSettingsDescriptor(document.getElementById('name'), api.createSettingsDescriptor(() => [{ id: 'save', kind: 'action', label: 'Save owner command',
      run: () => window.holdSave ? new Promise((_, reject) => { window.rejectSave = reject }) : Promise.reject(Error('Synthetic failed save')) }]))
  })
  await expect.poll(() => page.evaluate(() => window.models.at(-1).title)).toBe('Save owner')
  await activate(page, 'Save owner command')
  await expect.poll(() => page.evaluate(() => window.models.at(-1).rows.some(row => row.label === 'This setting could not be changed. Try again.'))).toBe(true)
  await page.evaluate(() => { window.holdSave = true })
  await activate(page, 'Save owner command')
  await page.evaluate(() => { window.profile = 'B'; window.rejectSave(Error('Late failure')); window.settingsDescriptors.settingsPresentationChanged() })
  await expect.poll(() => page.evaluate(() => window.models.at(-1).scope)).toContain('B')
  expect(await page.evaluate(() => window.models.at(-1).rows.some(row => row.label === 'This setting could not be changed. Try again.'))).toBe(false)
})

test('oversized explicit fields retain the complete web editor instead of sending a truncated value', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => {
    const api = window.settingsDescriptors
    api.registerSettingsDescriptor(document.getElementById('name'), api.createSettingsDescriptor(() => [{
      id: 'long', kind: 'input', label: 'Complete value', value: 'x'.repeat(131073), run() {}
    }]))
  })
  await expect(page.locator('[data-browser-settings-frame]')).not.toHaveAttribute('data-native-settings')
  await expect(page.locator('#name')).toHaveValue('Original')
})
