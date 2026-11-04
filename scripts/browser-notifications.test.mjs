import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../apps/web-desktop/src/platform/notifications.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const sessionRoutes = { exports: {}, URL, URLSearchParams }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../apps/web-desktop/src/platform/session-route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, sessionRoutes)
const openTargets = { exports: {}, URL, URLSearchParams }
vm.runInNewContext(ts.transpileModule(readFileSync('apps/desktop/src/lib/hermes-open-target.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, openTargets)
const adapter = ts.transpileModule(readFileSync(new URL('../apps/web-desktop/src/upstream/browser-notifications.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText

function notifications({ permission = 'granted', supported = true, secure = true, worker, rejectPage = false, oldWorker = false } = {}) {
  const shown = [], calls = [], callbacks = new Map(), cleared = []
  class Notification {
    static permission = permission
    static async requestPermission() {
      calls.push('permission')
      return this.permission = 'granted'
    }
    constructor(title, options) {
      if (rejectPage) throw new Error('Page notifications unavailable')
      shown.push({ title, options, notification: this })
    }
    close() { calls.push('close') }
  }
  const location = { href: 'https://athena.example.test/#/settings?tab=notifications' }
  const window = { isSecureContext: secure, location, focus: () => calls.push('focus'), open: (...args) => calls.push(['open', ...args]), setTimeout, clearTimeout }
  const root = { inert: false }
  const routing = vm.createContext({ exports: {}, window, URL, crypto: { randomUUID }, document: { getElementById: () => root } })
  vm.runInContext(ts.transpileModule(readFileSync(new URL('../apps/web-desktop/src/platform/notification-navigation.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, routing)
  if (worker && !oldWorker) worker.active ??= { postMessage(_message, ports) { ports?.[0]?.postMessage({ notificationCallbacks: 1 }) } }
  class MessageChannel { constructor() { this.port1 = { close() {} }; this.port2 = { close() {}, postMessage: data => this.port1.onmessage?.({ data }) } } }
  const navigator = worker ? { serviceWorker: { ready: Promise.resolve(worker) } } : {}
  const context = vm.createContext({ exports: {}, Notification, window, navigator, URL, MessageChannel,
    require: name => name === './session-route' ? sessionRoutes.exports : name === './android' ? { isAndroidApp: () => false } : name === './notification-navigation' ? routing.exports : ({ browserCapabilities: () => ({ notifications: supported }) }) })
  vm.runInContext(compiled, context)
  return { api: context.exports, routing: routing.exports, shown, calls, callbacks, cleared, Notification, window, root,
    installOwner(knownOwnerForSession, android = false) {
      window.hermesDesktop = { notify: context.exports.webNotify }
      const ownerContext = { exports: {}, window, Promise, require: name => {
        if (name === '@/lib/hermes-open-target') return openTargets.exports
        if (name === '@/store/native-notifications') return {
          invokePluginNotifyActivate: id => callbacks.get(id)?.body?.(),
          invokePluginNotifyAction: (id, action) => callbacks.get(id)?.actions?.[action]?.(),
          clearPluginNotifyHandlers: id => { assert.ok(id, 'never clear unrelated callback registrations'); cleared.push(id); callbacks.delete(id) }
        }
        if (name === '../platform/notification-navigation') return routing.exports
        if (name === '@/store/session-states') return { knownOwnerForSession }
        if (name === '../platform/android') return { isAndroidApp: () => android }
        if (name === '../platform/connection') return { WEB_CONNECTION_ID: 'web-single' }
        if (name === '../platform/notifications') return context.exports
        throw new Error(`Unexpected adapter import: ${name}`)
      } }
      vm.runInNewContext(adapter, ownerContext)
      return ownerContext.exports.installBrowserNotificationCommands()
    }
  }
}

test('responses never ask for permission; a user action can grant it', async () => {
  const { api, calls, shown } = notifications({ permission: 'default' })
  assert.equal(await api.webNotify({ kind: 'turnDone' }), false)
  assert.deepEqual(calls, [])
  assert.equal(await api.requestBrowserNotificationPermission(), 'granted')
  assert.deepEqual(calls, ['permission'])
  assert.equal(await api.webNotify({ kind: 'turnDone', body: 'Reply' }), true)
  assert.equal(shown[0].title, 'Athena · Response ready')
  assert.equal(shown[0].options.body, 'Reply')
})

test('denied, unsupported and insecure contexts return a useful status without prompting', async () => {
  for (const [options, expected] of [
    [{ permission: 'denied' }, 'denied'], [{ supported: false }, 'unsupported'], [{ secure: false }, 'insecure']
  ]) {
    const { api, calls } = notifications(options)
    assert.equal(api.browserNotificationPermission(), expected)
    assert.equal(await api.requestBrowserNotificationPermission(), expected)
    assert.equal(await api.webNotify({ body: 'Reply' }), false)
    assert.deepEqual(calls, [])
  }
})

test('permission request rejection does not break Settings', async () => {
  const { api, Notification } = notifications({ permission: 'default' })
  Notification.requestPermission = async () => { throw new Error('Blocked') }
  assert.equal(await api.requestBrowserNotificationPermission(), 'default')
})

test('mobile delivery and foreground tests use the service worker', async () => {
  const shown = []
  const { api } = notifications({ rejectPage: true, worker: { showNotification: async (...args) => shown.push(args) } })
  assert.equal(await api.webNotify({ kind: 'turnDone', body: 'Reply', focusSessionId: 'chat/id' }), true)
  assert.equal(shown[0][1].data.url, 'https://athena.example.test/#/chat%2Fid')
})

test('service-worker failure falls back to page delivery and click selects the response chat', async () => {
  const { api, shown, calls, window } = notifications({ worker: { showNotification: async () => { throw new Error('Unavailable') } } })
  assert.equal(await api.webNotify({ kind: 'turnDone', focusSessionId: 'chat-1' }), true)
  shown[0].notification.onclick()
  assert.equal(window.location.hash, '#/chat-1')
  assert.deepEqual(calls, ['focus', 'close'])
  const unavailable = notifications({ rejectPage: true })
  assert.equal(await unavailable.api.webNotify({ body: 'Reply' }), false)
})

test('waiting for a missing worker is bounded', async () => {
  const { shown, window } = notifications()
  let timeout
  window.setTimeout = (resolve, duration) => { timeout = duration; resolve() }
  // A registered service worker may never become ready in development.
  const context = vm.createContext({ exports: {}, URL, window,
    Notification: class { static permission = 'granted'; constructor() { shown.push('fallback') } },
    navigator: { serviceWorker: { ready: new Promise(() => {}) } },
    require: name => name === './android' ? { isAndroidApp: () => false } : ({ browserCapabilities: () => ({ notifications: true }) }) })
  vm.runInContext(compiled, context)
  assert.equal(await context.exports.webNotify({ body: 'Reply' }), true)
  assert.equal(timeout, 750)
  assert.deepEqual(shown, ['fallback'])
})

async function clickNotification(targetUrl, clients, { data = {}, action, dismiss = false } = {}) {
  const handlers = new Map()
  let pending
  const calls = []
  const self = { location: { origin: 'https://athena.example.test' },
    addEventListener: (event, callback) => handlers.set(event, callback),
    clients: { matchAll: async () => clients, openWindow: async url => calls.push(['open', url]) } }
  class MessageChannel {
    constructor() {
      this.port1 = { close() {} }
      this.port2 = { close() {}, postMessage: data => this.port1.onmessage?.({ data }) }
    }
  }
  vm.runInNewContext(readFileSync(new URL('../apps/web-desktop/public/notifications-sw.js', import.meta.url), 'utf8'), {
    self, URL, MessageChannel, setTimeout: callback => { queueMicrotask(callback); return 1 }, clearTimeout() {}
  })
  handlers.get(dismiss ? 'notificationclose' : 'notificationclick')({ action, notification: { data: { url: targetUrl, ...data }, close: () => calls.push(['close']) }, waitUntil: promise => { pending = promise } })
  await pending
  return calls
}

test('notification click prefers its conversation and leaves unrelated apps alone', async () => {
  const focused = [], routed = []
  const client = url => ({ url, focus: async () => focused.push(url), postMessage: (message, ports) => { routed.push(message.url); ports[0].postMessage({ ready: true }) } })
  const target = 'https://athena.example.test/#/chat-1'
  await clickNotification(target, [client('https://athena.example.test/other-app/'), client('https://athena.example.test/#/chat-2'), client(target)])
  assert.deepEqual(focused, [target])
  assert.deepEqual(routed, [target])
  await clickNotification(target, [client('https://athena.example.test/#/chat-2')])
  assert.deepEqual(routed, [target, target])
  assert.deepEqual(await clickNotification(target, [client('https://athena.example.test/other-app/')]), [['close'], ['open', target]])
  assert.deepEqual(await clickNotification('https://elsewhere.example.test/', []), [['close']])
})

test('a live page must admit notification routing before the worker can reuse it', async () => {
  const target = 'https://athena.example.test/?profile=research#/chat-1'
  const navigation = [], messages = []
  const client = {
    // This URL is the document's original route; the live profile may have changed.
    url: target,
    focus: async () => navigation.push('focus'),
    navigate: async url => navigation.push(url),
    postMessage: (message, ports) => { messages.push(message); ports[0].postMessage({ ready: false }) }
  }
  assert.deepEqual(await clickNotification(target, [client]), [['close'], ['open', target]])
  assert.deepEqual(navigation, [])
  assert.equal(messages[0].url, target)
})

test('notification routing tries another live page and falls back for older pages', async () => {
  const target = 'https://athena.example.test/#/chat-1', focused = []
  const client = ready => ({ url: target, focus: async () => focused.push(ready),
    postMessage: (_message, ports) => ports[0].postMessage({ ready }) })
  assert.deepEqual(await clickNotification(target, [client(false), client(true)]), [['close']])
  assert.deepEqual(focused, [true])
  assert.deepEqual(await clickNotification(target, [{ url: target, focus() { throw new Error('Must not focus without admission') } }]), [['close'], ['open', target]])
  assert.deepEqual(await clickNotification(target, [{ url: target, focus() {}, postMessage() {} }]), [['close'], ['open', target]])
})

test('a page notification opens another window if its profile changed before the click', async () => {
  const { api, shown, calls, window } = notifications()
  window.location.href = 'https://athena.example.test/?profile=research#/chat-2'
  await api.webNotify({ focusSessionId: 'chat-1' })
  window.location.href = 'https://athena.example.test/?profile=writer#/draft'
  shown[0].notification.onclick()
  assert.equal(window.location.hash, undefined)
  assert.deepEqual(calls, [['open', 'https://athena.example.test/?profile=research#/chat-1', '_blank', 'noopener,noreferrer'], 'close'])
})

test('a page notification leaves an update-frozen document intact', async () => {
  const { api, shown, calls, window, root } = notifications()
  await api.webNotify({ focusSessionId: 'chat-1' })
  root.inert = true
  shown[0].notification.onclick()
  assert.equal(window.location.hash, undefined)
  assert.deepEqual(calls, [['open', 'https://athena.example.test/#/chat-1', '_blank', 'noopener,noreferrer'], 'close'])
})

test('notification delivery captures the emitting engine owner before waiting and keeps it through fallback and clicks', async () => {
  let ready, owner = { connectionId: 'web-single', profile: 'helper', targetProfile: 'research' }
  const worker = new Promise(resolve => { ready = resolve })
  const seen = [], lookedUp = []
  const harness = notifications({ worker: { showNotification: async (...args) => { seen.push(args); await worker; throw new Error('Unavailable') } } })
  harness.window.location.href = 'https://athena.example.test/?profile=writer#/other-chat'
  const restore = harness.installOwner(id => { lookedUp.push(id); return owner })
  const payload = { kind: 'turnDone', sessionId: 'research-runtime', focusSessionId: 'copied-chat' }
  const delivering = harness.window.hermesDesktop.notify(payload)
  owner = { connectionId: 'web-single', profile: 'default' }
  payload.focusSessionId = undefined
  await new Promise(resolve => setImmediate(resolve))
  const target = 'https://athena.example.test/?profile=research#/copied-chat?profile=research'
  assert.deepEqual(lookedUp, ['research-runtime'])
  assert.equal(seen[0][1].data.url, target)
  ready()
  assert.equal(await delivering, true)
  assert.equal(harness.shown[0].options.data.url, target)
  harness.shown[0].notification.onclick()
  assert.deepEqual(harness.calls, [['open', target, '_blank', 'noopener,noreferrer'], 'close'])
  restore()
  assert.equal(harness.window.hermesDesktop.notify, harness.api.webNotify)
})

test('owned page alerts reuse an admitted document and preserve the exact profile in its hash', async () => {
  const harness = notifications()
  harness.window.location.href = 'https://athena.example.test/?profile=research#/other-chat'
  harness.installOwner(id => { assert.equal(id, 'stored-chat'); return 'research' })
  await harness.window.hermesDesktop.notify({ focusSessionId: 'stored-chat' })
  harness.shown[0].notification.onclick()
  assert.equal(harness.window.location.hash, '#/stored-chat?profile=research')
  assert.deepEqual(harness.calls, ['focus', 'close'])
})

test('engine notification admission leaves native delivery and unrelated bridge replacements alone', async () => {
  const native = notifications()
  const stopNative = native.installOwner(() => { throw new Error('Native owns delivery') }, true)
  assert.equal(native.window.hermesDesktop.notify, native.api.webNotify)
  stopNative()
  const foreign = notifications()
  const restore = foreign.installOwner(() => ({ connectionId: 'another-gateway', profile: 'research' }))
  assert.equal(await foreign.window.hermesDesktop.notify({ focusSessionId: 'chat' }), false)
  assert.deepEqual(foreign.shown, [])
  const replacement = () => Promise.resolve(true)
  foreign.window.hermesDesktop.notify = replacement
  restore()
  assert.equal(foreign.window.hermesDesktop.notify, replacement)
})

test('plugin page alerts validate navigation, consume the engine callback once and release all handlers', async () => {
  const harness = notifications()
  harness.installOwner(() => undefined)
  let body = 0, action = 0
  harness.callbacks.set('plugin-1', { body: () => body++, actions: { details: () => action++ } })
  await harness.window.hermesDesktop.notify({ kind: 'plugin', notifyId: 'plugin-1', activate: 'hermes://open/settings?tab=plugins', actions: [{ id: 'details', text: 'Details', activate: '/settings?tab=tools' }] })
  const notification = harness.shown[0]
  assert.equal(notification.options.data.url, 'https://athena.example.test/#/settings?tab=plugins')
  assert.equal(notification.options.actions, undefined, 'page notifications cannot carry native action buttons')
  notification.notification.onclick()
  notification.notification.onclick()
  assert.equal(body, 1)
  assert.equal(action, 0)
  assert.equal(harness.callbacks.has('plugin-1'), false)
  assert.equal(harness.window.location.hash, '#/settings?tab=plugins')
  for (const activate of ['https://elsewhere.example.test/', '//elsewhere.example.test/', '/a/../settings']) {
    harness.shown.length = 0
    await harness.window.hermesDesktop.notify({ kind: 'plugin', activate })
    assert.equal(harness.shown[0].options.data.url, harness.window.location.href)
  }
})

test('failed, dismissed and frozen plugin notifications release engine callbacks without invoking them', async () => {
  for (const options of [{ permission: 'denied' }, { rejectPage: true }, {}]) {
    const harness = notifications(options)
    harness.installOwner(() => undefined)
    let called = 0
    harness.callbacks.set('plugin-1', { body: () => called++ })
    const delivered = await harness.window.hermesDesktop.notify({ kind: 'plugin', notifyId: 'plugin-1', activate: '/settings' })
    if (delivered) harness.shown[0].notification.onclose()
    assert.equal(called, 0)
    assert.equal(harness.callbacks.has('plugin-1'), false)
  }
  const frozen = notifications()
  frozen.installOwner(() => undefined)
  let called = 0
  frozen.callbacks.set('frozen', { body: () => called++ })
  await frozen.window.hermesDesktop.notify({ kind: 'plugin', notifyId: 'frozen', activate: '/settings' })
  frozen.root.inert = true
  frozen.shown[0].notification.onclick()
  assert.equal(called, 0)
  assert.equal(frozen.callbacks.has('frozen'), false)
  assert.equal(frozen.window.location.hash, undefined)
  frozen.root.inert = false
  frozen.callbacks.set('expired', { body: () => called++ })
  frozen.routing.activateBrowserNotificationCallback({ ...frozen.shown[0].options.data, notifyId: 'expired', expiresAt: Date.now() - 1 })
  assert.equal(called, 0)
  assert.equal(frozen.callbacks.has('expired'), false)
})

test('persistent plugin actions retain validated destinations and the emitting document identity', async () => {
  const shown = []
  const harness = notifications({ worker: { showNotification: async (...args) => shown.push(args) } })
  harness.installOwner(() => undefined)
  let clicked = 0
  harness.callbacks.set('plugin-1', { actions: { details: () => clicked++ } })
  await harness.window.hermesDesktop.notify({ kind: 'plugin', notifyId: 'plugin-1', activate: '/settings?tab=plugins',
    actions: [{ id: 'details', text: 'Details', activate: '/settings?tab=tools' }] })
  const data = shown[0][1].data
  assert.deepEqual(JSON.parse(JSON.stringify(shown[0][1].actions)), [{ action: 'details', title: 'Details' }])
  assert.equal(data.actions[0].url, 'https://athena.example.test/#/settings?tab=tools')
  assert.equal(harness.routing.activateBrowserNotificationCallback({ ...data, source: 'another-document', actionId: 'details' }), false)
  assert.equal(clicked, 0)
  assert.equal(harness.routing.activateBrowserNotificationCallback({ ...data, actionId: 'details' }), true)
  assert.equal(clicked, 1)
  assert.equal(harness.callbacks.has('plugin-1'), false)
})

test('the worker tries callback ownership before routing and never transfers a callback to another document', async () => {
  const target = 'https://athena.example.test/#/settings?tab=plugins', events = []
  const client = (name, owner) => ({ url: 'https://athena.example.test/#/chat',
    focus: async () => events.push(`focus:${name}`), postMessage(message, ports) {
      if (message.type === 'ATHENA_NOTIFICATION_ACTIVATE') { events.push(`callback:${name}:${message.actionId || 'body'}`); ports[0].postMessage({ owned: owner }) }
      else { events.push(`route:${name}`); ports[0].postMessage({ ready: true }) }
    } })
  await clickNotification(target, [client('peer', false), client('source', true)], { data: { source: 'source-document', notifyId: 'plugin-1', actions: [{ id: 'details', url: target }] }, action: 'details' })
  assert.deepEqual(events, ['callback:peer:details', 'callback:source:details', 'route:source', 'focus:source'])
  events.length = 0
  await clickNotification(target, [client('peer', false)], { data: { source: 'closed-source', notifyId: 'plugin-1' } })
  assert.deepEqual(events, ['callback:peer:body', 'route:peer', 'focus:peer'])
  events.length = 0
  await clickNotification(target, [client('source', true)], { data: { source: 'source-document', notifyId: 'plugin-1' }, dismiss: true })
  assert.deepEqual(events, ['callback:source:body'])
  assert.deepEqual(await clickNotification(target, [], { data: { actions: [{ id: 'bad', url: 'https://elsewhere.example.test/' }] }, action: 'bad' }), [['close']])
})

test('an older worker falls back to a page alert without losing plugin callbacks', async () => {
  let persistent = 0, clicked = 0
  const harness = notifications({ oldWorker: true, worker: { active: { postMessage() {} }, showNotification: async () => persistent++ } })
  harness.installOwner(() => undefined)
  harness.callbacks.set('plugin-1', { body: () => clicked++ })
  assert.equal(await harness.window.hermesDesktop.notify({ kind: 'plugin', notifyId: 'plugin-1', activate: '/settings' }), true)
  assert.equal(persistent, 0)
  harness.shown[0].notification.onclick()
  assert.equal(clicked, 1)
})

test('replacing a persistent tag clears superseded callbacks only after successful publication', async () => {
  const old = { source: 'another-document', notifyId: 'old-plugin', url: 'https://athena.example.test/#/settings' }, messages = []
  const worker = { getNotifications: async () => [{ data: old }], showNotification: async () => {},
    active: { postMessage(message, ports) { if (message.type === 'ATHENA_NOTIFICATION_CAPABILITIES') ports[0].postMessage({ notificationCallbacks: 1 }); else { messages.push(message); ports?.[0]?.postMessage({ dismissed: true }) } } } }
  const harness = notifications({ worker })
  harness.installOwner(() => undefined)
  await harness.window.hermesDesktop.notify({ kind: 'plugin', notifyId: 'new-plugin', tag: 'same-plugin', activate: '/settings' })
  assert.equal(messages[0].type, 'ATHENA_NOTIFICATION_DISMISS')
  assert.equal(messages[0].data.notifyId, 'old-plugin')
  messages.length = 0
  worker.showNotification = async () => { throw new Error('Refused') }
  await harness.window.hermesDesktop.notify({ kind: 'plugin', notifyId: 'failed-plugin', tag: 'same-plugin', activate: '/settings' })
  assert.equal(messages.length, 0, 'the older visible alert retains its callback when replacement fails')
})

test('a throwing plugin callback still releases its registration and allows navigation', async () => {
  const harness = notifications()
  harness.installOwner(() => undefined)
  harness.callbacks.set('plugin-error', { body() { throw new Error('Plugin failed') } })
  await harness.window.hermesDesktop.notify({ kind: 'plugin', notifyId: 'plugin-error', activate: '/settings' })
  assert.doesNotThrow(() => harness.shown[0].notification.onclick())
  assert.equal(harness.callbacks.has('plugin-error'), false)
  assert.equal(harness.window.location.hash, '#/settings')
})

test('callback-only persistent clicks focus the source without overwriting plugin navigation', async () => {
  const events = [], target = 'https://athena.example.test/#/old-chat'
  const source = { url: target, focus: async () => events.push('focus'), postMessage(message, ports) {
    events.push(message.type)
    ports[0].postMessage({ owned: true, ready: true })
  } }
  await clickNotification(target, [source], { data: { source: 'source-document', notifyId: 'plugin-1', navigate: false } })
  assert.deepEqual(events, ['ATHENA_NOTIFICATION_ACTIVATE', 'focus'])
})

test('older pages can ignore focus requests without being navigated', async () => {
  const messages = [], target = 'https://athena.example.test/#/old-chat'
  const older = { url: target, focus() { throw new Error('Older page did not admit focus') }, postMessage(message, ports) {
    messages.push(message.type)
    if (message.type === 'ATHENA_NOTIFICATION_ROUTE') ports[0].postMessage({ ready: true })
  } }
  assert.deepEqual(await clickNotification(target, [older], { data: { navigate: false } }), [['close'], ['open', target]])
  assert.deepEqual(messages, ['ATHENA_NOTIFICATION_FOCUS'])
})
