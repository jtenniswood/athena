import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

function surface({ live = false } = {}) {
  const state = []
  let cursor = 0
  let closes = 0
  const element = (type, props) => ({ type, props })
  const dependencies = {
    jsx: element, jsxs: element,
    useRef: value => ({ current: value }),
    useState: initial => {
      const index = cursor++
      if (!(index in state)) state[index] = initial
      return [state[index], value => { state[index] = value }]
    },
    useEffect: () => {},
    useNativeActionMenus: persistent => !persistent || live,
    NativeActionSurface: 'native',
    Dialog: { Root: 'dialog', Portal: 'portal', Overlay: 'overlay', Content: 'content', Title: 'title' }
  }
  const context = vm.createContext({ exports: {}, require: () => dependencies })
  vm.runInContext(ts.transpileModule(readFileSync('apps/web-desktop/src/experience/ui/action-surface.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, context)
  return {
    render(groups) {
      cursor = 0
      return context.exports.BrowserActionSurface({
        title: 'Actions', groups, compact: true,
        anchor: { x: 0, y: 0, returnFocus: {} }, onClose: () => { closes++ }
      })
    },
    closes: () => closes
  }
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined
  if (predicate(tree)) return tree
  const children = Array.isArray(tree) ? tree : tree.props?.children
  return (Array.isArray(children) ? children : [children]).map(child => find(child, predicate)).find(Boolean)
}

test('Android persistent selections update checks and disabled rows without closing the sheet', () => {
  const ui = surface()
  let checked = false
  const groups = () => [{ key: 'visibility', actions: [{
    key: 'sessions', label: 'Sessions', checked, disabled: checked, keepOpen: true,
    run: () => { checked = !checked }
  }] }]
  const first = ui.render(groups())
  assert.equal(first.type, 'dialog')
  find(first, node => node.props?.['data-action-key'] === 'sessions').props.onClick()
  const updated = ui.render(groups())
  assert.equal(updated.type, 'dialog')
  const row = find(updated, node => node.props?.['data-action-key'] === 'sessions')
  assert.equal(row.props['aria-checked'], true)
  assert.equal(row.props.disabled, true)
  assert.equal(ui.closes(), 0)
})

test('nested persistent selections stay in their submenu after a change', () => {
  const ui = surface()
  let checked = false
  const groups = () => [{ key: 'filters', actions: [{
    key: 'kind', label: 'Kind', run() {}, children: [{ key: 'kind', selection: 'single', actions: [{
      key: 'bots', label: 'Bots', checked, keepOpen: true, run: () => { checked = true }
    }] }]
  }] }]
  const root = ui.render(groups())
  assert.equal(root.type, 'dialog')
  find(root, node => node.props?.['data-action-key'] === 'kind').props.onClick()
  find(ui.render(groups()), node => node.props?.['data-action-key'] === 'bots').props.onClick()
  const updated = ui.render(groups())
  assert.equal(find(updated, node => node.props?.['data-action-key'] === 'bots').props['aria-checked'], true)
  assert.equal(find(updated, node => node.props?.['data-action-key'] === 'kind'), undefined)
  assert.equal(ui.closes(), 0)
})

test('Android menus with only closing commands keep the native presentation', () => {
  assert.equal(surface().render([{ key: 'actions', actions: [{ key: 'rename', label: 'Rename', run() {} }] }]).type, 'native')
})

test('Android hosts with live controls use native sheets for persistent menus too', () => {
  assert.equal(surface({ live: true }).render([{ key: 'filters', actions: [{
    key: 'bots', label: 'Bots', checked: true, keepOpen: true, run() {}
  }] }]).type, 'native')
})
