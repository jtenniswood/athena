import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

const root = path.resolve('apps/web-desktop')
function evaluate(source, require, globals = {}) {
  const context = vm.createContext({ exports: {}, require, ...globals })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    esModuleInterop: true, jsx: ts.JsxEmit.React
  }, fileName: 'fixture.tsx' }).outputText, context)
  return context.exports
}
function adapter(name) {
  const file = path.join(root, 'src/upstream', name)
  return evaluate(readFileSync(file, 'utf8'), createRequire(file))
}
const canonicalFile = path.join(root, '../desktop/src/plugins/hermes-bots/canonical-chat.ts')
const canonicalSource = adapter('transforms.ts').transformRenderer(readFileSync(canonicalFile, 'utf8'), canonicalFile).code
function canonicalHarness(lookup) {
  const opens = [], requests = []
  const host = {
    api: request => { requests.push(request); return lookup(request) },
    openSession: async (id, options) => { opens.push({ id, options }) }
  }
  const dependencies = {
    botOwner: owner => ({ bot: owner, name: owner.name, key: owner.name, route: null }),
    botWorkspaceOwnerKey: bot => bot.name,
    backendTargetProfile: (_route, name) => name,
    requestForBot: () => { throw Error('Unexpected profile RPC: browser lookup must use REST') }
  }
  const module = evaluate(canonicalSource, name => name === '@hermes/plugin-sdk' ? { host } : dependencies,
    { window: { __HERMES_WEB_BRIDGE__: true, hermesDesktop: host, setTimeout } })
  return { ...module, opens, requests }
}
const row = { id: 'canonical', resolved_id: 'tip', title: 'Bot Chat', message_count: 2 }

test('background Bot refresh preserves refreshInPlace and cannot swallow a foreground open', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const h = canonicalHarness(() => pending)
  const owner = { name: 'writer' }
  const background = h.openBotCanonicalChat(owner, { background: true })
  const foreground = h.openBotCanonicalChat(owner, { openingStillCurrent: () => true })
  assert.equal(h.requests.length, 2)
  assert.equal(h.requests[0].profile, 'writer')
  assert.match(h.requests[0].path, /include_hidden=true&title=Bot%20Chat/)
  release({ sessions: [row] })
  await Promise.all([background, foreground])
  assert.equal(h.opens.length, 2)
  assert.equal(h.opens[0].id, 'tip')
  assert.equal(h.opens[0].options.refreshInPlace, true)
  assert.equal(h.opens[0].options.awaitHydration, false)
  assert.equal(h.opens[1].options.refreshInPlace, undefined)
  assert.equal(h.opens[1].options.workspaceOwnerKey, 'writer')
})

test('a cancelled canonical lookup never navigates and a newer Bot choice can reopen', async () => {
  let release, current = true
  const pending = new Promise(resolve => { release = resolve })
  const h = canonicalHarness(() => pending)
  const owner = { name: 'writer' }
  const stale = h.openBotCanonicalChat(owner, { openingStillCurrent: () => current })
  current = false
  const latest = h.openBotCanonicalChat(owner, { openingStillCurrent: () => true })
  release({ sessions: [row] })
  assert.equal(await stale, null)
  assert.equal((await latest).openedId, 'tip')
  assert.equal(h.opens.length, 1)
})

test('background Bot lookup never creates a chat and failed lookups fail closed', async () => {
  const empty = canonicalHarness(() => ({ sessions: [] }))
  assert.equal(await empty.openBotCanonicalChat({ name: 'writer' }, { background: true }), null)
  assert.equal(empty.opens.length, 0)
  const failed = canonicalHarness(() => { throw Error('Gateway unavailable') })
  await assert.rejects(failed.openBotCanonicalChat({ name: 'writer' }), /not starting a new chat/)
  assert.equal(failed.opens.length, 0)
})

test('browser connecting visual retains the boot owner and stays absent after cold boot', () => {
  const file = path.join(root, '../desktop/src/components/gateway-connecting-overlay.tsx')
  const source = adapter('browser-plugin.ts').useBrowserConnectingVisual(readFileSync(file, 'utf8'))
  const boot = { visible: true, running: true, progress: 0, error: null }
  const dependencies = {
    $desktopBoot: boot, $gatewayState: 'closed', $gatewaySwitching: false,
    useStore: store => store, prefersReducedMotion: () => true,
    useRef: current => ({ current }), useState: value => [typeof value === 'function' ? value() : value, () => {}],
    useEffect() {}, createElement: (type, props) => ({ type, props }),
    isOnboardingEnabled: () => false, isMainWindow: () => true
  }
  const { GatewayConnectingOverlay } = evaluate(source.replace('import.meta.env.DEV', 'false'), () => dependencies, { React: dependencies })
  assert.equal(typeof GatewayConnectingOverlay, 'function')
  assert.equal(GatewayConnectingOverlay().props.phase, 'live')
  boot.visible = false; boot.running = false; boot.progress = 100
  assert.equal(GatewayConnectingOverlay(), null)
  boot.running = true; boot.error = 'Failed'
  assert.equal(GatewayConnectingOverlay(), null)
})
