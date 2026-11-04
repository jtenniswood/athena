import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

const compile = file => ts.transpileModule(readFileSync(file, 'utf8').replaceAll('import.meta.url', "'https://web.example.test/assets/ambient-client.js'"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const scope = 'a'.repeat(64)

function client({ supported = true, failure } = {}) {
  const workers = [], timers = new Map(), listeners = new Map()
  let nextTimer = 0
  class SharedWorker {
    constructor() {
      if (failure === 'construct') throw new Error('Worker refused')
      this.sent = []
      this.port = {
        postMessage: message => { if (failure === 'post') throw new Error('Port failed'); this.sent.push(message) },
        start() { if (failure === 'start') throw new Error('Port failed') },
        close: () => { this.closed = true }
      }
      workers.push(this)
    }
    reply(id, owns) { this.port.onmessage({ data: { id, owns } }) }
  }
  const window = {
    setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id },
    clearTimeout: id => timers.delete(id),
    addEventListener: (name, callback) => listeners.set(name, callback)
  }
  const context = vm.createContext({ exports: {}, window, URL, ...(supported ? { SharedWorker } : {}),
    require: () => ({ runtimeConfig: () => ({ gateway: { id: scope } }) }) })
  vm.runInContext(compile('apps/web-desktop/src/platform/ambient-claims.ts'), context)
  return {
    claim: context.exports.claimBrowserAmbientCue, workers, timers,
    expire() { for (const [id, callback] of [...timers]) { timers.delete(id); callback() } },
    leave() { listeners.get('pagehide')() }
  }
}

for (const options of [{ supported: false }, { failure: 'construct' }, { failure: 'post' }, { failure: 'start' }]) {
  test(`unsupported or refused ambient transport retains emit behavior: ${JSON.stringify(options)}`, async () => {
    const app = client(options)
    assert.equal(await app.claim('speak:turn:reply'), true)
    assert.equal(await app.claim('speak:turn:reply'), true)
    assert.equal(app.timers.size, 0)
    assert.ok(app.workers.every(worker => worker.closed))
  })
}

test('ambient replies address their own request and configured gateway', async () => {
  const app = client(), first = app.claim('speak:turn:first'), second = app.claim('turn-end:second')
  assert.equal(app.workers.length, 1)
  const worker = app.workers[0], [a, b] = worker.sent
  assert.equal(a.scope, scope)
  assert.equal(a.key, 'speak:turn:first')
  worker.reply(b.id, false); worker.reply(a.id, true)
  assert.deepEqual(await Promise.all([first, second]), [true, false])
  assert.equal(app.timers.size, 0)
})

test('missing and malformed replies expire without silencing a cue or settling a later request', async () => {
  const app = client(), first = app.claim('speak:turn:slow'), worker = app.workers[0]
  const initial = worker.sent[0].id
  worker.reply(initial, 'invalid')
  assert.equal(app.timers.size, 1)
  app.expire()
  assert.equal(await first, true)
  const second = app.claim('speak:turn:next')
  worker.reply(initial, false)
  assert.equal(app.timers.size, 1)
  worker.reply(worker.sent.at(-1).id, false)
  assert.equal(await second, false)
})

for (const type of ['error', 'messageerror']) {
  test(`worker ${type} releases current claims and preserves later emit behavior`, async () => {
    const app = client(), first = app.claim('speak:turn:reply'), worker = app.workers[0]
    if (type === 'error') worker.onerror({ preventDefault() {} })
    else worker.port.onmessageerror()
    assert.equal(await first, true)
    assert.equal(await app.claim('speak:turn:later'), true)
    assert.equal(worker.closed, true)
    assert.equal(app.timers.size, 0)
    assert.equal(app.workers.length, 1)
  })
}

test('page departure releases pending requests and a restored page reconnects', async () => {
  const app = client(), first = app.claim('speak:turn:before')
  app.leave()
  assert.equal(await first, true)
  assert.equal(app.workers[0].closed, true)
  const next = app.claim('speak:turn:after'), worker = app.workers[1]
  worker.reply(worker.sent[0].id, false)
  assert.equal(await next, false)
  assert.equal(app.timers.size, 0)
})

test('an unanswered transport cannot accumulate unbounded pending claims', async () => {
  const app = client(), requests = Array.from({ length: 1000 }, (_, index) => app.claim(`turn-end:${index}`))
  assert.ok(app.workers[0].sent.length < requests.length)
  app.expire()
  assert.ok((await Promise.all(requests)).every(owns => owns === true))
  assert.equal(app.timers.size, 0)
})

test('the shared worker retains renderer expiry policy and isolates gateway namespaces', () => {
  let now = 0
  const policy = vm.createContext({ exports: {}, Date: { now: () => now } })
  vm.runInContext(compile('apps/desktop/electron/event-dedupe.ts'), policy)
  const self = {}, worker = vm.createContext({ exports: {}, self, require: () => policy.exports })
  vm.runInContext(compile('apps/web-desktop/src/platform/ambient-claims.worker.ts'), worker)
  let nextId = 0
  const connect = () => {
    const replies = []
    const port = { postMessage: value => replies.push(value), start() {} }
    self.onconnect({ ports: [port] })
    return (key, gateway = scope) => {
      const id = ++nextId
      port.onmessage({ data: { id, key, scope: gateway } })
      assert.equal(replies.at(-1)?.id, id)
      return replies.at(-1).owns
    }
  }
  const first = connect(), peer = connect()
  assert.equal(first('speak:turn:reply'), true)
  assert.equal(peer('speak:turn:reply'), false)
  assert.equal(first('turn-end:reply'), true)
  assert.equal(peer('turn-end:reply'), false)
  assert.equal(peer('speak:turn:reply', 'b'.repeat(64)), true)
  now = 1001
  assert.equal(peer('turn-end:reply'), true)
  assert.equal(peer('speak:turn:reply'), false)
  now = policy.exports.SPEECH_CLAIM_TTL_MS
  assert.equal(peer('speak:turn:reply'), true)
})
