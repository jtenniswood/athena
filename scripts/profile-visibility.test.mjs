import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

function load(file, dependencies, globals = {}) {
  const context = vm.createContext({ exports: {}, require: () => dependencies, ...globals })
  const source = readFileSync(`apps/web-desktop/src/${file}`, 'utf8')
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, context)
  return context.exports
}

function navigation({ active = 'default', all = false, hidden = ['archived'], names = ['archived', 'default', 'writer', 'research'] } = {}) {
  const selections = []
  const element = (type, props) => ({ type, props })
  const model = { active, all, items: names.map(key => ({ key, appearance: {} })), select: value => selections.push(value) }
  const { BrowserProfileNavigation } = load('experience/profile-navigation.tsx', {
    jsx: element, jsxs: element,
    useRef: value => ({ current: value }),
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
    useEffect: () => {},
    useBrowserProfiles: () => model,
    useMobileBrowser: () => false,
    readHiddenProfiles: () => hidden,
    readHideAllProfilesButton: () => false,
    BrowserActionSurface: 'surface',
    avatarColor: () => null
  })
  const tree = BrowserProfileNavigation({})
  const surface = tree.props.children.find(child => child.type === 'surface')
  return {
    selections,
    toggle: name => surface.props.groups.flatMap(group => group.actions).find(action => action.key === `profile-${name}`).run()
  }
}

test('hiding the active default selects the first unhidden profile in rail order', () => {
  const ui = navigation()
  ui.toggle('default')
  assert.deepEqual(ui.selections, ['writer'])
})

test('hiding the last visible profile falls back to All profiles', () => {
  const ui = navigation({ names: ['default'] })
  ui.toggle('default')
  assert.deepEqual(ui.selections, [null])
})

test('visibility changes preserve a different active profile or an explicit All profiles scope', () => {
  for (const options of [{ active: 'writer' }, { all: true }, { hidden: ['default'] }]) {
    const ui = navigation(options)
    ui.toggle('default')
    assert.deepEqual(ui.selections, [])
  }
})

function atom(initial) {
  let value = initial
  const listeners = new Set()
  return {
    get: () => value,
    set: next => { value = next; for (const listener of listeners) listener(next) },
    listen: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    subscribe: listener => { listener(value); listeners.add(listener); return () => listeners.delete(listener) }
  }
}

function restoration({ saved = null, active = 'default', all = false, hidden = ['default'], order = ['research', 'writer'] } = {}) {
  const profiles = atom([]), current = atom(active), scope = atom(all)
  const storage = new Map(saved ? [['hermes-web.browser.profile', saved]] : [])
  const selections = []
  const window = {}
  const { restoreBrowserProfile } = load('upstream/profiles.ts', {
    $profiles: profiles, $activeGatewayProfile: current, $showAllProfiles: scope,
    $profileOrder: atom(order),
    readHiddenProfiles: () => hidden,
    setShowAllProfiles: value => scope.set(value),
    selectProfile: name => { selections.push(name); scope.set(false); current.set(name) },
    sortByProfileOrder: (items, keys) => [...items].sort((a, b) => keys.indexOf(a.name) - keys.indexOf(b.name))
  }, {
    window,
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
  })
  const stop = restoreBrowserProfile()
  const publish = () => profiles.set([
    { name: 'default', is_default: true }, { name: 'writer' }, { name: 'research' }
  ])
  return { selections, publish, stop, current, scope, storage, window }
}

test('profile arrival restores the first visible profile when the default or saved profile is hidden', () => {
  for (const options of [{}, { saved: 'default' }, { saved: 'writer', hidden: ['default', 'writer'] }]) {
    const state = restoration(options)
    state.publish()
    assert.deepEqual(state.selections, ['research'])
    assert.equal(state.scope.get(), false)
    assert.equal(state.window.__HERMES_WEB_ACTIVE_PROFILE__, 'research')
    assert.equal(state.storage.get('hermes-web.browser.profile'), 'research')
    state.publish()
    assert.equal(state.selections.length, 1)
    state.stop()
  }
})

test('restoration preserves a visible saved profile and tolerates all profiles being hidden', () => {
  for (const options of [{ saved: 'writer' }, { hidden: ['default', 'writer', 'research'] }, { hidden: [] }]) {
    const state = restoration(options)
    state.publish()
    assert.deepEqual(state.selections, [])
    state.stop()
  }
})
