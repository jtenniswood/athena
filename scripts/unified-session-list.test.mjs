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
  if (file === 'build/renderer/browser-plugin.ts') return createBuildModuleLoader().load(filename)
  const context = vm.createContext({ exports: {}, require: mocks || createRequire(filename), ...globals })
  vm.runInContext(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText, context)
  return context.exports
}
test('profile grouping uses the native all-profile scope', () => {
  const { useBrowserSidebarController } = load('build/renderer/browser-plugin.ts')
  const source = readFileSync(path.join(root, '../desktop/src/app/chat/sidebar/index.tsx'), 'utf8')
  const output = useBrowserSidebarController(source, root)
  assert.match(output, /useBrowserProfileGroups\(useGatewaySessionGroups\(agentSessions, ownerGrouped, filtersNarrow\)\)/)
  assert.doesNotMatch(output, /browserPresentationMode/)
})

test('profile sections reuse configured pictures and keep exact owner routes', () => {
  const { useBrowserProfileControllers } = load('build/renderer/browser-plugin.ts')
  const module = 'app/chat/sidebar/gateway-groups.tsx'
  const source = readFileSync(path.join(root, '../desktop/src', module), 'utf8')
  const output = useBrowserProfileControllers(source, root)
  const slot = output.slice(output.indexOf('function ProfileGroupHeaderSlot'))
  const itemsExpression = slot.match(/const items = ([^\n]+)/)[1]
  const contributions = [{ id: 'hermes-bots:screen-portal' }, { id: 'other:header' }]
  assert.deepEqual(Array.from(vm.runInNewContext(itemsExpression, {
    useContributions: () => contributions, SIDEBAR_PROFILE_GROUP_HEADER_AREA: 'sidebar.profileGroup.header'
  })), [contributions[1]])
  assert.match(output, /BrowserProfileGroupControllerSurface/)
  assert.match(output, /sessions, renderRows, children,/)
  assert.match(output, /newSessionInAgent\(\{ connectionId: group.connectionId, profile \}\)/)
  assert.match(output, /!owner \|\| presentationMode/)
  assert.equal(ts.createSourceFile(module, output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0)
  assert.throws(() => useBrowserProfileControllers(source.replace('function GatewayProfileGroup(', 'function ChangedGroup('), root), /controller changed/)
  const element = (type, props) => ({ type, props })
  let enabled = true
  const { useBrowserProfileSection } = load('src/upstream/profile-section.tsx', () => ({
    useStore: () => enabled ? 'profile' : 'none',
    useBrowserPreference: key => key === 'combinedProfiles' ? enabled : false, useEffect: () => {},
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

  const { useBrowserSessionReordering } = load('build/renderer/browser-plugin.ts')
  const section = readFileSync(path.join(root, '../desktop/src/app/chat/sidebar/sessions-section.tsx'), 'utf8')
  const output = useBrowserSessionReordering(section, 'section')
  const expression = output.match(/const hasGroupedSessions = ([^\n]+)/)[1]
  assert.equal(vm.runInNewContext(expression, { groups: empty }), true)
  assert.equal(vm.runInNewContext(expression, { groups: [{ mode: 'project', sessions: [] }] }), false)
})


test('profile layout switches scope without changing grouping or selecting a fresh conversation', () => {
  let grouping = 'status', combined = true, all = true
  const { setBrowserProfilesCombined } = load('src/upstream/profile-section.tsx', id => ({
    $sidebarGrouping: { get: () => grouping }, setSidebarGrouping: value => { grouping = value },
    browserPreference: () => ({ write: value => { combined = value } }),
    setShowAllProfiles: value => { all = value }
  }))
  setBrowserProfilesCombined(false)
  assert.equal(grouping, 'status')
  assert.equal(combined, false)
  assert.equal(all, false)
  setBrowserProfilesCombined(true)
  assert.equal(grouping, 'status')
  assert.equal(combined, true)
  assert.equal(all, true)
  grouping = 'profile'
  setBrowserProfilesCombined(false)
  assert.equal(grouping, 'none')
})

test('combined profiles keep backend project membership and isolate disclosure identities', () => {
  const { browserProfileProjectGroups } = load('src/upstream/profile-projects.tsx', () => ({}))
  const a = { id: 'a', profile: 'research', connection_id: 'local' }
  const b = { id: 'b', profile: 'research', connection_id: 'local' }
  const projects = [{ id: 'p', label: 'Project', path: '/workspace/project', sessionIds: ['a'], repos: [] }]
  const groups = browserProfileProjectGroups([a, b], projects)
  assert.deepEqual(Array.from(groups, group => group.label), ['Home', 'Project'])
  assert.equal(groups[0].sessions[0], b)
  assert.equal(groups[1].sessions[0], a)
  assert.equal(groups[1].project, projects[0])
  const other = browserProfileProjectGroups([{ ...a, profile: 'writer' }], projects)
  assert.notEqual(other[0].id, groups[1].id)
  assert.deepEqual(Array.from(browserProfileProjectGroups([], projects)), [])
})

test('combined project rows retain saved menu identity, independent disclosure and captured creation routes', () => {
  const element = (type, props) => ({ type, props }), disclosure = [], creates = [], splits = []
  const { BrowserProfileProjects, BrowserProfileProjectRow } = load('src/upstream/profile-projects.tsx', () => ({
    jsx: element, jsxs: element, WEB_CONNECTION_ID: 'web-single', useRef: () => ({ current: null }),
    useWorkspaceNodeOpen: id => { disclosure.push(id); return [true, () => {}] },
    BrowserProjectControllerSurface: 'project-surface'
  }))
  const ids = Array.from({ length: 6 }, (_, index) => `chat-${index}`)
  const saved = { id: 'p_saved', label: 'Repairs', path: null, icon: 'tools', color: 'blue', repos: [{ path: '/workspace/repairs', groups: [] }], sessionIds: ids, sessionCount: ids.length }
  const render = profile => {
    const [row] = BrowserProfileProjects({ sessions: ids.map(id => ({ id, profile })), projects: [saved], renderRows: rows => rows,
      onNewSession: (path, owner) => creates.push([path, owner.profile]),
      onNewSessionSplit: (dir, options) => splits.push([dir, options.route.profile]) })
    return BrowserProfileProjectRow(row.props).props.model
  }
  const research = render('research'), writer = render('writer')
  assert.equal(research.project, saved)
  assert.equal(writer.project, saved)
  assert.equal(research.rows.length, ids.length)
  assert.notEqual(disclosure[0], disclosure[1])
  research.onNewSession(research.newSessionPath)
  writer.onNewSession(writer.newSessionPath)
  research.onNewSessionSplit('right', { cwd: research.newSessionPath })
  assert.deepEqual(creates, [['/workspace/repairs', 'research'], ['/workspace/repairs', 'writer']])
  assert.deepEqual(splits, [['right', 'research']])
})
