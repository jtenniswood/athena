import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

test('channel controls follow profile conversations, including pinned and search-hidden rows', () => {
  let sessions = []
  let scope = 'default'
  const stores = { $messagingSessions: 'sessions', $profileScope: 'scope' }
  const context = vm.createContext({ exports: {}, require: id => {
    if (id === '@nanostores/react') return { useStore: store => store === 'sessions' ? sessions : scope }
    if (id === '@/store/session' || id === '@/store/profile') return stores
    if (id === '@/app/chat/sidebar/profile-scope') return {
      filterSessionsByProfileScope: (rows, profile) => rows.filter(row => profile === '__all__' || row.profile === profile)
    }
    if (id === '@/lib/session-source') return {
      normalizeSessionSource: source => source?.trim().toLowerCase() || null,
      sessionSourceLabel: source => ({ telegram: 'Telegram', slack: 'Slack' })[source] ?? source
    }
    throw new Error(`Unexpected import: ${id}`)
  } })
  const source = readFileSync('apps/web-desktop/src/upstream/sidebar-channels.ts', 'utf8')
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const read = () => JSON.parse(JSON.stringify(context.exports.useBrowserSidebarChannels()))
  assert.deepEqual(read(), [], 'An empty gateway must not offer the platform catalog')
  sessions = [
    { source: 'Telegram', profile: 'default', pinned: true },
    { source: 'telegram', profile: 'default' },
    { source: 'slack', profile: 'research' },
    { source: null, profile: 'default' }
  ]
  assert.deepEqual(read(), [{ key: 'messaging:telegram', label: 'Telegram' }])
  scope = 'research'
  assert.deepEqual(read(), [{ key: 'messaging:slack', label: 'Slack' }])
  scope = '__all__'
  assert.deepEqual(read(), [
    { key: 'messaging:telegram', label: 'Telegram' },
    { key: 'messaging:slack', label: 'Slack' }
  ])
  sessions = []
  assert.deepEqual(read(), [], 'Removing conversations must remove their fallback controls')
})
