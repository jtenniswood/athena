import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../apps/web-desktop/src/platform/notifications.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText

function notifications({ permission = 'granted', supported = true, secure = true, worker, rejectPage = false } = {}) {
  const shown = [], calls = []
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
  const window = { isSecureContext: secure, location, focus: () => calls.push('focus'), open: (...args) => calls.push(['open', ...args]), setTimeout }
  const root = { inert: false }
  const routing = vm.createContext({ exports: {}, window, URL, document: { getElementById: () => root } })
  vm.runInContext(ts.transpileModule(readFileSync(new URL('../apps/web-desktop/src/platform/notification-navigation.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, routing)
  const navigator = worker ? { serviceWorker: { ready: Promise.resolve(worker) } } : {}
  const context = vm.createContext({ exports: {}, Notification, window, navigator, URL,
    require: name => name === './android' ? { isAndroidApp: () => false } : name === './notification-navigation' ? routing.exports : ({ browserCapabilities: () => ({ notifications: supported }) }) })
  vm.runInContext(compiled, context)
  return { api: context.exports, shown, calls, Notification, window, root }
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

async function clickNotification(targetUrl, clients) {
  let handler, pending
  const calls = []
  const self = { location: { origin: 'https://athena.example.test' },
    addEventListener: (_event, callback) => { handler = callback },
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
  handler({ notification: { data: { url: targetUrl }, close: () => calls.push(['close']) }, waitUntil: promise => { pending = promise } })
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
