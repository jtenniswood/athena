import { createBuildModuleLoader } from './renderer-adapter.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

const root = path.resolve('apps/web-desktop')
function load(file, mocks, globals = {}) {
  const filename = path.join(root, file)
  if (file === 'src/upstream/browser-plugin.ts') return createBuildModuleLoader().load(filename)
  const context = vm.createContext({ exports: {}, require: mocks || createRequire(filename), ...globals })
  vm.runInContext(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText, context)
  return context.exports
}
test('profile grouping uses the native all-profile scope', () => {
  const { useBrowserSessionPresentation } = load('src/upstream/browser-plugin.ts')
  const source = readFileSync(path.join(root, '../desktop/src/app/chat/sidebar/index.tsx'), 'utf8')
  const output = useBrowserSessionPresentation(source, root)
  assert.match(output, /label=\{grouping === 'profile' \? 'Profiles' : sessionsLabel\}/)
  assert.doesNotMatch(output, /browserPresentationMode/)
})

test('profile sections reuse configured pictures and keep exact owner routes', () => {
  const { useBrowserProfileSectionPictures } = load('src/upstream/browser-plugin.ts')
  const module = 'app/chat/sidebar/gateway-groups.tsx'
  const source = readFileSync(path.join(root, '../desktop/src', module), 'utf8')
  const output = useBrowserProfileSectionPictures(source, root)
  const slot = output.slice(output.indexOf('function ProfileGroupHeaderSlot'))
  const itemsExpression = slot.match(/const items = ([^\n]+)/)[1]
  const contributions = [{ id: 'hermes-bots:screen-portal' }, { id: 'other:header' }]
  assert.deepEqual(Array.from(vm.runInNewContext(itemsExpression, {
    useContributions: () => contributions, SIDEBAR_PROFILE_GROUP_HEADER_AREA: 'sidebar.profileGroup.header'
  })), [contributions[1]])
  assert.match(output, /browserProfile\?\.picture \?\? <ProfileGlyph/)
  assert.match(output, /browserProfile\?\.label/)
  assert.match(output, /newSessionInAgent\(\{ connectionId: group.connectionId, profile \}\)/)
  assert.match(output, /!owner \|\| presentationMode/)
  assert.equal(ts.createSourceFile(module, output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0)
  assert.throws(() => useBrowserProfileSectionPictures(source.replace('name={group.profile}', 'name={other}'), root), /boundary changed/)
  const element = (type, props) => ({ type, props })
  let enabled = true
  const { useBrowserProfileSection } = load('src/upstream/profile-section.tsx', () => ({
    useStore: () => enabled ? 'profile' : 'none',
    useBrowserProfiles: () => ({ items: [{ key: 'research', label: 'Researcher', botName: 'Research', appearance: { color: 'blue', image: 'https://example.invalid/profile.png', shape: 'circle' } }] }),
    jsx: element, jsxs: element, avatarColor: color => color, BotFace: 'face'
  }))
  assert.equal(useBrowserProfileSection('research').label, 'Researcher')
  assert.equal(useBrowserProfileSection('research').picture.props.children.props.image, 'https://example.invalid/profile.png')
  assert.equal(useBrowserProfileSection('unknown').label, 'unknown')
  enabled = false
  assert.equal(useBrowserProfileSection('research'), null)
})

test('profile grouping keeps empty configured profiles as new conversation entry points', () => {
  let profiles = [{ name: 'default' }, { name: 'research' }]
  const { useBrowserProfileGroups } = load('src/upstream/profile-groups.ts', id => {
    if (id === '@nanostores/react') return { useStore: store => store === 'profiles' ? profiles : {} }
    if (id === '@/store/profile') return { $profiles: 'profiles', $profileColors: 'colors' }
    if (id === '@/lib/profile-color') return { resolveProfileColor: name => `${name}-color` }
    if (id === '../platform/connection') return { WEB_CONNECTION_ID: 'web-single' }
    throw new Error(`Unexpected import: ${id}`)
  })
  assert.equal(useBrowserProfileGroups(undefined), undefined)
  const empty = useBrowserProfileGroups([])
  assert.deepEqual(Array.from(empty, group => group.profile), ['default', 'research'])
  assert.ok(empty.every(group => group.sessions.length === 0))
  assert.equal(empty[1].connectionId, 'web-single')
  assert.equal(empty[1].id, JSON.stringify(['web-single', 'research']))
  assert.equal(empty[1].color, 'research-color')
  const populated = { ...empty[1], sessions: [{ id: 'research-chat' }] }
  const input = [populated]
  const mixed = useBrowserProfileGroups(input)
  assert.equal(mixed.length, 2)
  assert.equal(mixed[1], populated)
  assert.equal(input.length, 1)
  const legacy = { ...populated, id: JSON.stringify([null, 'research']), connectionId: null }
  assert.equal(useBrowserProfileGroups([legacy]).length, 2)
  assert.equal(useBrowserProfileGroups([legacy])[1], legacy)
  profiles = [...profiles, { name: 'writing' }]
  assert.equal(useBrowserProfileGroups(input).length, 3)

  const { useBrowserSessionReordering } = load('src/upstream/browser-plugin.ts')
  const section = readFileSync(path.join(root, '../desktop/src/app/chat/sidebar/sessions-section.tsx'), 'utf8')
  const output = useBrowserSessionReordering(section, 'section')
  const expression = output.match(/const hasGroupedSessions = ([^\n]+)/)[1]
  assert.equal(vm.runInNewContext(expression, { groups: empty }), true)
  assert.equal(vm.runInNewContext(expression, { groups: [{ mode: 'project', sessions: [] }] }), false)
})
