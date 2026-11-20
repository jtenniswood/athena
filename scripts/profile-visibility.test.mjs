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

test('profile restoration keeps the sidebar combined and restores the tab profile without selecting a chat', () => {
  const current = atom('default')
  const scope = atom(false)
  const savedProfiles = []
  const { restoreBrowserProfile } = load('upstream/profiles.ts', {
    $activeGatewayProfile: current,
    $showAllProfiles: scope,
    readBrowserTabProfile: () => 'writer',
    rememberBrowserTabProfile: value => savedProfiles.push(value),
    setShowAllProfiles: value => scope.set(value)
  }, { window: {} })

  const stop = restoreBrowserProfile()
  assert.equal(scope.get(), true)
  assert.equal(current.get(), 'writer')
  assert.deepEqual(savedProfiles, ['writer'])

  scope.set(false)
  assert.equal(scope.get(), true)
  current.set('research')
  assert.deepEqual(savedProfiles, ['writer', 'research'])
  stop()
  scope.set(false)
  assert.equal(scope.get(), false)
})
