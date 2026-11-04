import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const compile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 }
}).outputText
const module = { exports: {} }
vm.runInNewContext(compile('../apps/web-desktop/src/platform/session-summaries.ts'), module)
const { createSessionSummaries } = module.exports
const row = (overrides = {}) => ({ id: 'chat', profile: 'research', last_active: 10, message_count: 2, ...overrides })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function setup(overrides = {}) {
  const saved = new Map(), calls = [], reads = []
  let account = 'account-a', clock = 1000
  const deps = {
    storage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
    gateway: 'gateway', account: () => account, now: () => clock,
    context: async session => { reads.push(session); return { opening: ['Build a preview'], recent: ['Keep it cheap'], reply: 'Working on the feature' } },
    generate: async (session, input) => { calls.push({ session, input }); return 'Build useful chat previews using a cheap model.' },
    fingerprint: async input => createHash('sha256').update(input).digest('hex'),
    ...overrides
  }
  return { deps, saved, calls, reads, service: createSessionSummaries(deps), account: value => { account = value }, tick: () => { clock += 60_001 } }
}

test('concurrent hovers share one generation; reload and unchanged inputs reuse the browser cache', async () => {
  const s = setup(), session = row()
  await Promise.all([s.service.refresh(session), s.service.refresh(session)])
  assert.equal(s.calls.length, 1)
  assert.equal(s.service.get(session), 'Build useful chat previews using a cheap model.')
  await createSessionSummaries(s.deps).refresh(session)
  assert.equal(s.reads.length, 1)
  // A metadata-only change and a replayed completion do not buy another model call.
  await s.service.refresh(row({ last_active: 11, message_count: 10 }))
  await s.service.refresh(row({ last_active: 11, message_count: 10 }), true)
  assert.equal(s.calls.length, 1)
  assert.doesNotMatch([...s.saved.values()].join(''), /Keep it cheap|Working on the feature/)
})

test('cache identity isolates accounts, gateways, connections and profiles while following compression', async () => {
  const s = setup()
  await s.service.refresh(row({ _lineage_root_id: 'root' }))
  assert.ok(s.service.get(row({ id: 'compressed', _lineage_root_id: 'root' })))
  assert.equal(s.service.get(row({ _lineage_root_id: 'root', profile: 'writer' })), null)
  assert.equal(s.service.get(row({ _lineage_root_id: 'root', connection_id: 'other' })), null)
  assert.equal(createSessionSummaries({ ...s.deps, gateway: 'other' }).get(row()), null)
  s.account('account-b')
  assert.equal(s.service.get(row({ _lineage_root_id: 'root' })), null)
  s.account(undefined)
  await s.service.refresh(row())
  assert.equal(s.calls.length, 1)
})

test('late generation from a previous account cannot publish or persist', async () => {
  const gate = deferred(), started = deferred()
  const s = setup({ generate: async () => { started.resolve(); return gate.promise } })
  const work = s.service.refresh(row())
  await started.promise
  s.account('account-b')
  gate.resolve('Private account A summary')
  await work
  assert.equal(s.service.get(row()), null)
  assert.equal(s.saved.size, 0)
})

test('newer scope changes supersede queued work and late results', async () => {
  const gate = deferred(), started = deferred(), generated = []
  const s = setup({ generate: async (session, input) => {
    generated.push(JSON.parse(input))
    if (session.message_count === 2) { started.resolve(); return gate.promise }
    return 'Research the revised purpose.'
  }, context: async session => ({ opening: ['Original goal'], recent: [String(session.message_count)], reply: '' }) })
  const first = s.service.refresh(row())
  await started.promise
  const second = s.service.refresh(row({ message_count: 4 }))
  const third = s.service.refresh(row({ message_count: 6 }))
  gate.resolve('Obsolete summary')
  await Promise.all([first, second, third])
  assert.equal(generated.length, 2)
  assert.equal(generated[1].recent[0], '6')
  assert.equal(s.service.get(row()), 'Research the revised purpose.')
})

test('a completed turn rechecks unchanged list metadata and retains the old summary on failure', async () => {
  let input = 'First goal', fail = false
  const s = setup({ context: async () => ({ opening: [input], recent: [], reply: '' }),
    generate: async () => { if (fail) throw new Error('Offline'); return input } })
  await s.service.refresh(row())
  input = 'Revised goal'
  await s.service.refresh(row(), true)
  assert.equal(s.service.get(row()), 'Revised goal')
  fail = true
  input = 'Another request'
  await s.service.refresh(row({ message_count: 4 }))
  assert.equal(s.service.get(row()), 'Revised goal')
  fail = false
  await s.service.refresh(row({ message_count: 4 }))
  assert.equal(s.service.get(row()), 'Revised goal')
  s.tick()
  await s.service.refresh(row({ message_count: 4 }))
  assert.equal(s.service.get(row()), 'Another request')
})

test('blocked storage remains usable and cross-tab locking rechecks the shared cache', async () => {
  const s = setup({ storage: { getItem() { throw new Error('Denied') }, setItem() { throw new Error('Denied') } } })
  await s.service.refresh(row())
  assert.ok(s.service.get(row()))
  const shared = setup()
  let lockTail = Promise.resolve()
  const lock = (_key, work) => { const task = lockTail.then(work); lockTail = task; return task }
  const a = createSessionSummaries({ ...shared.deps, lock }), b = createSessionSummaries({ ...shared.deps, lock })
  await Promise.all([a.refresh(row()), b.refresh(row())])
  assert.equal(shared.calls.length, 1)
  assert.equal(a.get(row()), b.get(row()))
})

test('bounded caches evict old entries and reject malformed saved values', async () => {
  const s = setup()
  for (let i = 0; i < 105; i++) { s.tick(); await s.service.refresh(row({ id: `chat-${i}` })) }
  assert.equal(Object.keys(JSON.parse([...s.saved.values()][0])).length, 100)
  assert.equal(s.service.get(row({ id: 'chat-0' })), null)
  s.saved.set([...s.saved.keys()][0], '{broken')
  assert.equal(createSessionSummaries(s.deps).get(row()), null)
})

test('adapter routes stateless generation to the preview owner and never resumes a chat', async () => {
  let options
  const requests = [], messageReads = []
  const page = { messages: [
    { role: 'user', content: 'Original goal' }, { role: 'assistant', content: 'Interim tool narration', interim: true },
    { role: 'user', content: 'A private hidden message', hidden: true }, { role: 'assistant', content: 'Visible context' }
  ], pagination: { order: 'latest' } }
  const context = { exports: {}, localStorage: {}, navigator: {}, require(name) {
    if (name === '../platform/session-summaries') return { SUMMARY_INSTRUCTIONS: 'goal', createSessionSummaries: deps => {
      options = deps; return { refresh: async () => {}, get: () => null }
    } }
    if (name === '@/hermes') return { getSessionMessages: async (...args) => { messageReads.push(args); return page } }
    if (name === '@/lib/chat-messages') return { toChatMessages: rows => rows, chatMessageText: message => message.content }
    if (name === '@/store/gateway') return { requestGatewayForAgent: async (...args) => { requests.push(args); return { text: 'Summary' } } }
    if (name === '@/store/session-states') return { $workingSessionIds: { get: () => [] } }
    if (name === '../platform/runtime') return { runtimeConfig: () => ({ gateway: { id: 'gateway' } }) }
    if (name === '../platform/connection') return { WEB_CONNECTION_ID: 'web-single' }
    if (['@/contrib/events', '@/store/session', '../platform/preference-sync'].includes(name)) return {}
    throw new Error(`Unexpected dependency: ${name}`)
  } }
  vm.runInNewContext(compile('../apps/web-desktop/src/upstream/session-summaries.ts'), context)
  context.exports.readPreviewSummary(row())
  const owner = row({ connection_id: 'remote', profile: 'writer' })
  await options.generate(owner, 'Bounded context')
  const [connection, profile, method, params] = requests[0]
  assert.equal(connection, 'remote')
  assert.equal(profile, 'writer')
  assert.equal(method, 'llm.oneshot')
  assert.equal(params.task, 'title_generation')
  assert.equal(params.max_tokens, 160)
  assert.equal(params.session_id, undefined)
  const result = await options.context(owner)
  assert.equal(result.opening.join(''), 'Original goal')
  assert.equal(result.reply, 'Visible context')
  assert.equal(messageReads.length, 2)
  assert.equal(messageReads[0][1].connectionId, 'remote')
  assert.equal(messageReads[0][1].profile, 'writer')
  assert.ok(messageReads.every(call => call[3].passive && call[2].includeCompacted))
})
