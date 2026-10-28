import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const compile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText
const androidSource = compile('../apps/web-desktop/src/platform/android.ts')
const notificationsSource = compile('../apps/web-desktop/src/platform/notifications.ts')

function native({ fail = false } = {}) {
  const calls = [], timers = new Map(), events = []
  let permission = 'default', timerId = 0
  const bridge = {
    onmessage: null,
    postMessage(raw) {
      const request = JSON.parse(raw)
      calls.push(request)
      if (fail) throw new Error('Disconnected')
      if (request.method === 'requestPermission') permission = 'granted'
      const value = request.method === 'notify' ? permission === 'granted' : permission
      bridge.onmessage({ data: JSON.stringify({ id: request.id, value }) })
    }
  }
  const window = {
    AthenaAndroid: bridge,
    dispatchEvent: event => events.push(event.type),
    setTimeout: fn => { timers.set(++timerId, fn); return timerId },
    clearTimeout: id => timers.delete(id)
  }
  const context = vm.createContext({ exports: {}, window, Event: class { constructor(type) { this.type = type } } })
  vm.runInContext(androidSource, context)
  return { api: context.exports, window, bridge, calls, timers, events }
}

test('native permission requests and alerts work without the web Notifications API', async () => {
  const { api, calls, timers, events } = native()
  assert.equal(api.isAndroidApp(), true)
  assert.equal(api.androidNotificationPermission(), 'default')
  assert.equal(await api.androidNotify({ kind: 'turnDone' }), false)
  assert.equal(await api.refreshAndroidNotificationPermission(true), 'granted')
  assert.equal(api.androidNotificationPermission(), 'granted')
  const payload = { kind: 'turnDone', focusSessionId: 'chat/id', tag: 'turn-1' }
  assert.equal(await api.androidNotify(payload), true)
  assert.deepEqual(calls.at(-1).payload, payload)
  assert.equal(timers.size, 0)
  assert.deepEqual(events, ['athena:notification-permission'])
})

test('native bridge failures settle without breaking the chat or leaking pending requests', async () => {
  const { api, timers } = native({ fail: true })
  assert.equal(await api.androidNotify({}), false)
  assert.equal(await api.refreshAndroidNotificationPermission(), 'default')
  assert.equal(timers.size, 0)
})

test('native notifications bypass browser capability and permission gates', async () => {
  const { api: android, window } = native()
  await android.refreshAndroidNotificationPermission(true)
  const context = vm.createContext({ exports: {}, window,
    require: name => name === './android' ? android : { browserCapabilities: () => ({ notifications: false }) }
  })
  vm.runInContext(notificationsSource, context)
  assert.equal(context.exports.browserNotificationPermission(), 'granted')
  assert.equal(await context.exports.webNotify({ kind: 'turnDone', focusSessionId: 'chat-1' }), true)
})

test('unanswered native requests time out, and late or malformed replies are ignored', async () => {
  const { api, bridge, timers } = native()
  bridge.postMessage = () => {}
  const result = api.androidNotify({})
  bridge.onmessage({ data: 'invalid json' })
  bridge.onmessage({ data: JSON.stringify({ id: 'unrelated', value: true }) })
  for (const timeout of timers.values()) timeout()
  assert.equal(await result, false)
  bridge.onmessage({ data: JSON.stringify({ id: '1', value: true }) })
})

test('Access reload distinguishes an unloaded page from a mounted app and waits for draft safety', async () => {
  const source = compile('../apps/web-desktop/src/platform/android-navigation.ts')
  const window = new EventTarget(), replies = []
  let finish
  const context = vm.createContext({ exports: {}, window, document: { getElementById: () => null },
    require: name => name === './android' ? { isAndroidApp: () => true, androidNavigationReady: result => replies.push(result) }
      : { reloadReadinessAfterSaving: () => new Promise(resolve => { finish = resolve }) }
  })
  vm.runInContext(source, context)
  assert.equal(window.dispatchEvent(new Event('athena:prepare-native-navigation', { cancelable: true })), true, 'Access page has no draft guard')
  const stop = context.exports.installAndroidNavigationGuard()
  assert.equal(window.dispatchEvent(new Event('athena:prepare-native-navigation', { cancelable: true })), false, 'mounted app takes ownership before asynchronous saving')
  assert.equal(replies.length, 0)
  finish({ ready: false, reason: 'Recording in progress' })
  await Promise.resolve(); await Promise.resolve()
  assert.equal(replies[0].ready, false)
  stop()
  assert.equal(window.dispatchEvent(new Event('athena:prepare-native-navigation', { cancelable: true })), true)
})

test('settings discovery cannot hide native chrome before the web entry is rendered', async () => {
  const { api, bridge, calls, timers } = native()
  bridge.postMessage = raw => {
    const request = JSON.parse(raw)
    calls.push(request)
    const value = request.method === 'hello'
      ? { protocol: 1, appVersion: 'test', capabilities: ['settings-menu'], insets: 'native', typography: 'platform' }
      : true
    bridge.onmessage({ data: JSON.stringify({ id: request.id, value }) })
  }
  assert.equal(await api.androidAppSettingsMenu(true), true)
  assert.deepEqual(calls.map(call => call.method), ['hello'])
  assert.equal(await api.androidAppSettingsMenu(true, true), true)
  assert.equal(calls.at(-1).payload.rendered, true)
  assert.equal(await api.androidAppSettingsMenu(false), true)
  assert.equal(calls.at(-1).payload.mounted, false)
  assert.equal(timers.size, 0)
})

test('structured native errors settle requests and keep a usable fallback', async () => {
  const { api, bridge, timers } = native()
  bridge.postMessage = raw => {
    const { id } = JSON.parse(raw)
    bridge.onmessage({ data: JSON.stringify({ id, error: { code: 'unsupported-method', message: 'Update required' } }) })
  }
  assert.equal(await api.androidOpenAppSettings(), false)
  assert.equal(timers.size, 0)
})

test('asynchronous navigation approvals retain the originating request ID', async () => {
  const source = compile('../apps/web-desktop/src/platform/android-navigation.ts')
  const window = new EventTarget(), replies = [], finishes = []
  const context = vm.createContext({ exports: {}, window, document: { getElementById: () => null },
    require: name => name === './android' ? { isAndroidApp: () => true, androidNavigationReady: result => replies.push(result) }
      : { reloadReadinessAfterSaving: () => new Promise(resolve => finishes.push(resolve)) }
  })
  vm.runInContext(source, context)
  const stop = context.exports.installAndroidNavigationGuard()
  for (const requestId of ['first', 'second']) {
    const event = new Event('athena:prepare-native-navigation', { cancelable: true })
    event.detail = { requestId }
    window.dispatchEvent(event)
  }
  finishes[1]({ ready: true }); finishes[0]({ ready: false })
  await Promise.resolve(); await Promise.resolve()
  assert.deepEqual(replies.map(reply => reply.requestId), ['second', 'first'])
  stop()
})
