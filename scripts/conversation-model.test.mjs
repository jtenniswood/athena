import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText
const contract = { exports: {} }
vm.runInNewContext(source('../apps/web-desktop/src/experience/contracts/conversation.ts'), contract)

function model() {
  const stores = {
    $selectedStoredSessionId: { value: 'session-a' },
    $sessionResumeRequest: { value: null },
    $selectedBot: { value: 'web-single::default' },
    $groupChatWorkspace: { value: null },
    $sessions: { value: [{ id: 'session-a', title: 'First chat', profile: 'default' }, { id: 'session-b', title: 'Second chat' }] },
    $lastRoster: { value: [] },
    $workspaceMode: { value: 'sessions' },
    $workspaceOwnerKey: { value: null }
  }
  const context = { exports: {}, require(name) {
    if (name === '@nanostores/react') return { useStore: store => store.value }
    if (name === '../experience/contracts/conversation') return contract.exports
    if (name === '@/plugins/hermes-bots/routing') return { botWorkspaceOwnerKey: bot => bot.workspaceOwnerKey }
    if (['@/store/session', '@/plugins/hermes-bots/group-chat', '@/plugins/hermes-bots/data', '@/plugins/hermes-bots/bot-state', '@/components/pane-shell/workspace-scope'].includes(name)) return stores
    throw new Error(`Unexpected adapter dependency: ${name}`)
  } }
  vm.runInNewContext(source('../apps/web-desktop/src/upstream/conversation.ts'), context)
  return { stores, read: context.exports.useBrowserConversation }
}

test('background Bot selection metadata cannot dismiss the current conversation navigation', () => {
  const { stores, read } = model()
  const before = read()
  // Observed during startup: the qualified roster key becomes a profile name.
  stores.$selectedBot.value = 'default'
  const after = read()
  assert.equal(after.id, before.id)
  assert.equal(after.selectionKey, before.selectionKey)
})

test('session and Bot identity hydration does not change the selected conversation key', () => {
  const { stores, read } = model()
  stores.$sessions.value = []
  const loading = read()
  stores.$sessions.value = [{ id: 'session-a', title: 'Loaded chat' }]
  assert.equal(read().selectionKey, loading.selectionKey)
  stores.$lastRoster.value = [{ name: 'default', connectionId: 'web-single', canonical_session: { id: 'session-a' } }]
  assert.equal(read().kind, 'bot')
  assert.equal(read().selectionKey, loading.selectionKey)
})

test('real conversation changes dismiss navigation while background state in a group does not', () => {
  const { stores, read } = model()
  const first = read().selectionKey
  stores.$selectedStoredSessionId.value = 'session-b'
  assert.notEqual(read().selectionKey, first)
  stores.$groupChatWorkspace.value = 'session-b'
  const group = read().selectionKey
  stores.$selectedStoredSessionId.value = 'session-a'
  stores.$selectedBot.value = 'other'
  assert.equal(read().selectionKey, group)
  stores.$groupChatWorkspace.value = 'another-group'
  assert.notEqual(read().selectionKey, group)
  stores.$groupChatWorkspace.value = null
  assert.equal(read().selectionKey, first)
})

test('hidden canonical Bot identity uses the exact engine workspace owner', () => {
  const { stores, read } = model()
  stores.$selectedStoredSessionId.value = 'hidden-chat'
  stores.$selectedBot.value = 'stale-selected-bot'
  stores.$lastRoster.value = [{ name: 'research', display_name: 'Research', connectionId: 'web-single', canonical_session: { id: 'hidden-chat' }, workspaceOwnerKey: 'exact-research-owner' }]
  stores.$workspaceMode.value = 'bots'
  stores.$workspaceOwnerKey.value = 'exact-research-owner'
  const identity = read()
  assert.equal(identity.kind, 'bot')
  assert.equal(identity.id, 'web-single::research')
  assert.equal(identity.profile, 'research')
  assert.equal(identity.displayName, 'Research')
  const key = identity.selectionKey
  stores.$workspaceOwnerKey.value = 'another-owner'
  assert.equal(read().status, 'loading')
  assert.equal(read().selectionKey, key)
  stores.$workspaceOwnerKey.value = 'exact-research-owner'
  stores.$workspaceMode.value = 'sessions'
  assert.equal(read().status, 'loading')
  stores.$workspaceMode.value = 'bots'
  stores.$selectedStoredSessionId.value = 'another-chat'
  assert.equal(read().status, 'loading')
})

test('the selected engine owner distinguishes copied session ids without borrowing another profile title', () => {
  const { stores, read } = model()
  stores.$sessionResumeRequest.value = { sessionId: 'session-a', ownerRoute: { connectionId: 'web-single', profile: 'research' } }
  const waiting = read()
  assert.equal(waiting.profile, 'research')
  assert.equal(waiting.status, 'loading')
  assert.equal(waiting.displayName, null)
  stores.$sessions.value.push({ id: 'session-a', title: 'Research copy', profile: 'research' })
  const loaded = read()
  assert.equal(loaded.profile, 'research')
  assert.equal(loaded.displayName, 'Research copy')
  assert.equal(loaded.selectionKey, waiting.selectionKey)
  stores.$sessionResumeRequest.value = { sessionId: 'session-a', ownerRoute: { connectionId: 'web-single', profile: 'default' } }
  assert.equal(read().displayName, 'First chat')
  assert.notEqual(read().selectionKey, loaded.selectionKey)
})

test('an owned canonical Bot alias retains its backend profile while the row hydrates', () => {
  const identity = contract.exports.resolveConversationIdentity({
    selectedSessionId: 'copied-id', selectedSessionOwner: { connectionId: 'web-single', profile: 'research' },
    selectedBotKey: null, groupName: null, sessions: [{ id: 'copied-id', profile: 'default' }], bots: [],
    selectedBotOwner: { name: 'helper', targetProfile: 'research', display_name: 'Research helper', canonical_session: { id: 'copied-id' } }
  })
  assert.equal(identity.kind, 'bot')
  assert.equal(identity.profile, 'research')
  assert.equal(identity.connectionId, 'web-single')
})

test('a canonical Bot alias can retain its logical profile as well as its backend target', () => {
  const identity = contract.exports.resolveConversationIdentity({
    selectedSessionId: 'alias-chat', selectedSessionOwner: { connectionId: 'web-single', profile: 'helper' },
    selectedBotKey: null, groupName: null, sessions: [], bots: [],
    selectedBotOwner: { name: 'helper', targetProfile: 'research', canonical_session: { id: 'alias-chat' } }
  })
  assert.equal(identity.kind, 'bot')
  assert.equal(identity.profile, 'helper')
})
