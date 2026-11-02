import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const root = path.resolve('apps/web-desktop')
function load(file, mocks, globals = {}) {
  const filename = path.join(root, file)
  const context = vm.createContext({ exports: {}, require: mocks || createRequire(filename), ...globals })
  vm.runInContext(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, context)
  return context.exports
}
const source = module => readFileSync(path.join(root, '../desktop/src', module), 'utf8')

test('sidebar preferences migrate known legacy identities without consulting current labels', () => {
  const { readHiddenSections, HIDDEN_SECTIONS_KEY } = load('src/experience/sidebar-section-preferences.ts')
  const storage = new Map()
  const read = () => Array.from(readHiddenSections({ getItem: key => storage.get(key) ?? null }))
  storage.set('hermes-web.browser.pinned-section-hidden', 'true')
  storage.set('hermes-web.browser.cron-section-hidden', 'true')
  assert.deepEqual(read(), ['pinned', 'cron-jobs'])
  storage.set(HIDDEN_SECTIONS_KEY, JSON.stringify(['projects', 'sessions', 'slack', 'imessage', 'api', 42, '__proto__', 'old-project']))
  assert.deepEqual(read(), ['messaging:slack', 'messaging:bluebubbles', 'messaging:api_server', '__proto__', 'old-project'])
  storage.set(HIDDEN_SECTIONS_KEY, JSON.stringify({ version: 2, hidden: ['messaging:slack', 'pinned', 'pinned', null] }))
  assert.deepEqual(read(), ['messaging:slack', 'pinned'])
  storage.set(HIDDEN_SECTIONS_KEY, '[]')
  assert.deepEqual(read(), [], 'An explicit empty preference supersedes the legacy flags')
  storage.set(HIDDEN_SECTIONS_KEY, '{')
  assert.deepEqual(read(), [])
  assert.deepEqual(Array.from(readHiddenSections({ getItem() { throw Error('Blocked') } })), [])
})

test('semantic adapters preserve identity and reject upstream drift', () => {
  const api = load('src/upstream/browser-plugin.ts')
  const sidebar = source('app/chat/sidebar/index.tsx')
  const adapted = api.useBrowserSectionIds(sidebar, root)
  assert.match(adapted, /browserSectionId="sessions" label=\{sessionsLabel\}/)
  assert.match(adapted, /browserSectionId=\{`messaging:\$\{group.sourceId\}`\}/)
  assert.match(adapted, /const browserChannels = useBrowserSidebarChannels\(\)/)
  assert.match(adapted, /browserChannels.map\(channel => \[channel.sourceId, \[\]\]\)/)
  assert.doesNotMatch(adapted, /!worktreeGroupingActive &&\s+messagingGroups.map/)
  assert.doesNotMatch(adapted, /showsAdvancedChrome && cronJobs\.length/)
  assert.throws(() => api.useBrowserSectionIds(sidebar.replace('label={sessionsLabel}', 'label={otherLabel}'), root), /target changed/)
  for (const name of ['sessions', 'cron-jobs']) {
    const output = api.useBrowserSectionIdentity(source(`app/chat/sidebar/${name}-section.tsx`), root)
    assert.match(output, /<SidebarGroup \{\.\.\.browserSection\}/)
    assert.match(output, /useBrowserSidebarSection\([^\n]*label\)/)
  }
  // An upstream icon change cannot alter which notice the browser suppresses.
  const updates = api.omitBrowserDesktopUpdateNotice(source('store/updates.ts').replace("icon: 'gift'", "icon: 'bell'"))
  assert.match(updates, /export function maybeNotifyUpdateAvailable[^\n]+\{\}/)
  assert.doesNotMatch(updates, /icon: 'bell'/)
  for (const module of ['components/desktop-install-overlay.tsx', 'components/remote-setup/first-run.tsx']) {
    const output = api.useBrowserSetupHooks(source(module))
    const count = module.includes('desktop-install') ? 3 : 1
    assert.equal(output.split('data-browser-overlay="setup"').length - 1, count)
    assert.equal(output.split('data-browser-overlay-card="setup"').length - 1, count)
  }

  const registry = JSON.parse(readFileSync(path.join(root, 'src/upstream/compatibility-registry.json')))
  const plugin = api.browserPlugin(root)
  for (const entry of registry.filter(entry => entry.kind === 'browser-transform' && entry.tests.some(t => t.file === 'scripts/sidebar-contracts.test.mjs'))) {
    const selectedPlugin = entry.order === 40 ? api.browserActivityNotificationsPlugin(root) : plugin
    const input = entry.order === 40
      ? load('src/upstream/transforms.ts').transformRenderer(source(entry.module), `/desktop/src/${entry.module}`).code
      : source(entry.module)
    const output = selectedPlugin.transform(input, `/desktop/src/${entry.module}`).code
    const parsed = ts.createSourceFile(entry.module, output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    assert.equal(parsed.parseDiagnostics.length, 0, entry.module)
    assert.equal(selectedPlugin.transform(output, `/desktop/src/${entry.module}`).code, output)
  }
})

test('saved messaging conversations survive missing channel configuration', () => {
  const api = load('src/upstream/browser-plugin.ts')
  const adapted = api.useBrowserSectionIds(source('app/chat/sidebar/index.tsx'), root)
  const start = adapted.indexOf('  const messagingGroups = useMemo')
  const end = adapted.indexOf('\n  // Recents and every messaging platform', start)
  assert.ok(start >= 0 && end > start)
  const context = vm.createContext({
    useMemo: callback => callback(),
    browserChannels: [{ sourceId: 'api_server' }],
    visibleMessagingSessions: [{ id: 'telegram-history', source: 'telegram', started_at: 20 }],
    normalizeSessionSource: value => value,
    isPinnedSession: () => false,
    messagingPlatformTotals: {}, messagingTruncated: false, messagingProfile: 'default',
    messagingTotalsKey: (profile, source) => `${profile}:${source}`,
    sessionTime: session => session.started_at,
    sessionSourceLabel: source => source === 'telegram' ? 'Telegram' : 'API'
  })
  const code = ts.transpileModule(adapted.slice(start, end) + '\nglobalThis.groups = messagingGroups', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText
  vm.runInContext(code, context)
  assert.deepEqual(JSON.parse(JSON.stringify(context.groups)).map(group => [group.sourceId, group.sessions.map(session => session.id)]), [
    ['telegram', ['telegram-history']], ['api_server', []]
  ])
})

function channelHarness(fetchPlatforms) {
  const stores = Object.fromEntries(['$activeConnectionId', '$gatewayState', '$platformsChangeTick', '$profiles', '$profileScope'].map(key => [key, { value: null }]))
  stores.$activeConnectionId.value = 'server-a'
  stores.$gatewayState.value = 'open'
  stores.$profileScope.value = 'default'
  stores.$profiles.value = [{ name: 'default' }, { name: 'work' }]
  let state = null, effect, cleanup
  const timers = []
  const events = { addEventListener() {}, removeEventListener() {} }
  const { useConfiguredSidebarChannels } = load('src/upstream/sidebar-channels.ts', id => {
    if (id === 'react') return {
      useState: () => [state, value => { state = value }],
      useEffect: callback => { effect = callback }
    }
    if (id === '@nanostores/react') return { useStore: store => store.value }
    if (id === '@/api/messaging') return { getMessagingPlatforms: fetchPlatforms }
    if (id === '@/lib/session-source') return { normalizeSessionSource: id => id.toLowerCase(), sessionSourceLabel: id => id === 'telegram' ? 'Telegram' : null }
    return { ...stores, ALL_PROFILES: '__all__' }
  }, { window: { ...events, setInterval: cb => timers.push(cb), clearInterval() {} }, document: { ...events, hidden: false } })
  return {
    stores,
    render: () => useConfiguredSidebarChannels(),
    commit() { cleanup?.(); cleanup = effect() },
    poll() { timers.at(-1)() }
  }
}

const settle = () => new Promise(resolve => setImmediate(resolve))
test('configured channels appear without chats and reject disabled or unconfigured platforms', async () => {
  let platforms = [
    { id: 'telegram', name: 'Telegram', enabled: true, configured: true, env_vars: ['secret'] },
    { id: 'slack', name: 'Slack', enabled: false, configured: true },
    { id: 'discord', name: 'Discord', enabled: true, configured: false }
  ]
  const harness = channelHarness(async () => ({ platforms }))
  assert.equal(harness.render().length, 0)
  harness.commit()
  await settle()
  assert.deepEqual(JSON.parse(JSON.stringify(harness.render())), [{ key: 'messaging:telegram', sourceId: 'telegram', label: 'Telegram' }])
  platforms = []
  harness.poll()
  await settle()
  assert.equal(harness.render().length, 0)
})

test('channel configuration follows profile scope and ignores stale responses', async () => {
  const pending = []
  const harness = channelHarness(profile => new Promise(resolve => pending.push({ profile, resolve })))
  harness.render(); harness.commit()
  harness.stores.$profileScope.value = 'work'
  assert.equal(harness.render().length, 0)
  harness.commit()
  pending[0].resolve({ platforms: [{ id: 'telegram', enabled: true, configured: true }] })
  await settle()
  assert.equal(harness.render().length, 0)
  pending[1].resolve({ platforms: [{ id: 'slack', name: 'Slack', enabled: true, configured: true }] })
  await settle()
  assert.equal(harness.render()[0].sourceId, 'slack')
  harness.stores.$profileScope.value = '__all__'
  harness.render(); harness.commit()
  assert.deepEqual(pending.slice(2).map(request => request.profile), ['default', 'work'])
  for (const request of pending.slice(2)) request.resolve({ platforms: [{ id: 'telegram', enabled: true, configured: true }] })
  await settle()
  assert.equal(harness.render().length, 1)
  harness.stores.$activeConnectionId.value = 'server-b'
  assert.equal(harness.render().length, 0)
})
