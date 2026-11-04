import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const { atom, onMount } = createRequire(path.resolve('apps/web-desktop/package.json'))('nanostores')
const sourceRoot = 'apps/web-desktop/src/'

function routeHarness(target = '#/pending-chat') {
  const requests = [], events = new Map()
  const selected = atom(null), request = atom(null), switching = atom(false)
  const window = {
    location: new URL(target, 'https://web.example.test/'),
    addEventListener(type, handler) { events.set(type, handler) },
    removeEventListener(type, handler) { if (events.get(type) === handler) events.delete(type) }
  }
  const evaluate = (file, dependencies = {}) => {
    const context = vm.createContext({ exports: {}, window, URL, URLSearchParams, require: () => dependencies })
    vm.runInContext(ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText, context)
    return context.exports
  }
  const routes = evaluate('apps/desktop/src/app/routes.ts', {
    atom, onMount, registry: { getArea: () => [], subscribeArea: () => () => {} }
  })
  const requestSessionResume = (sessionId, ownerRoute) => {
    const next = { sessionId, ...(ownerRoute ? { ownerRoute } : {}), sequence: requests.length + 1 }
    requests.push(JSON.parse(JSON.stringify(next)))
    request.set(next)
  }
  const owner = evaluate(sourceRoot + 'upstream/browser-session-routes.ts', {
    ...routes,
    ...evaluate(sourceRoot + 'platform/session-route.ts'),
    ...evaluate(sourceRoot + 'experience/tool-routes.ts'),
    WEB_CONNECTION_ID: 'web-single', $selectedStoredSessionId: selected,
    $sessionResumeRequest: request, $gatewaySwitching: switching, requestSessionResume
  })
  const dispose = owner.installBrowserSessionRoutes()
  return {
    requests, selected, request, switching, dispose, requestSessionResume,
    navigate(target, notify = true) {
      window.location = new URL(target, window.location.href)
      if (notify) events.get('popstate')?.({ type: 'popstate' })
    },
    install: owner.installBrowserSessionRoutes
  }
}

test('cold recovery reissues a bare chat URL through the engine resume command', () => {
  const h = routeHarness()
  assert.deepEqual(h.requests, [], 'ordinary unowned startup remains the engine route hook’s responsibility')
  h.switching.set(true)
  h.switching.set(false)
  assert.deepEqual(h.requests, [{ sessionId: 'pending-chat', sequence: 1 }])
  h.switching.set(false)
  assert.equal(h.requests.length, 1)
})

test('recovery preserves the hash owner independently of the window profile filter', () => {
  const h = routeHarness('?profile=writer#/copied-id?profile=research')
  const expected = { sessionId: 'copied-id', ownerRoute: { connectionId: 'web-single', profile: 'research' }, sequence: 1 }
  assert.deepEqual(h.requests, [expected])
  h.navigate('#/copied-id?profile=research')
  assert.equal(h.requests.length, 1, 'ordinary history admission deduplicates its existing request')
  h.switching.set(true)
  h.switching.set(false)
  assert.deepEqual(h.requests.at(-1), { ...expected, sequence: 2 })
})

test('a newer resume request wins even before its navigation updates the URL', () => {
  const h = routeHarness()
  h.switching.set(true)
  h.requestSessionResume('newer-chat', { connectionId: 'web-single', profile: 'writer' })
  h.switching.set(false)
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].sessionId, 'newer-chat')
})

test('an already selected conversation wins over the pending recovery URL', () => {
  const h = routeHarness()
  h.switching.set(true)
  h.selected.set('newer-chat')
  h.switching.set(false)
  assert.deepEqual(h.requests, [])
})

test('recovery reads the latest URL rather than replaying its starting chat', () => {
  const h = routeHarness()
  h.switching.set(true)
  h.navigate('#/latest-chat?profile=research', false)
  h.switching.set(false)
  assert.deepEqual(h.requests, [{
    sessionId: 'latest-chat', ownerRoute: { connectionId: 'web-single', profile: 'research' }, sequence: 1
  }])
})

test('new chat, settings, tools and malformed routes are never resumed as chats', () => {
  for (const target of ['#/', '#/settings?tab=gateway', '#/scheduled-tasks', '#/%E0%A4%A']) {
    const h = routeHarness()
    h.switching.set(true)
    h.navigate(target)
    h.switching.set(false)
    assert.deepEqual(h.requests, [], target)
    h.dispose()
  }
})

test('disposing route admission releases both history and recovery listeners', () => {
  const h = routeHarness()
  assert.equal(h.install(), h.dispose, 'repeated installation shares one owner')
  h.switching.set(true)
  h.dispose()
  h.navigate('#/later-chat?profile=writer')
  h.switching.set(false)
  assert.deepEqual(h.requests, [])
})
