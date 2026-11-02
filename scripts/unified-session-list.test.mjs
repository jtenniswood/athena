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
  const context = vm.createContext({ exports: {}, require: mocks || createRequire(filename), ...globals })
  vm.runInContext(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText, context)
  return context.exports
}
function initializer(source, name) {
  const parsed = ts.createSourceFile('selector.ts', source, ts.ScriptTarget.Latest, true)
  return parsed.statements.flatMap(node => ts.isVariableStatement(node) ? Array.from(node.declarationList.declarations) : [])
    .find(node => node.name.getText(parsed) === name).initializer.getText(parsed)
}

test('the combined session scope survives saved profile choices and opening another profile', () => {
  const { transformRenderer } = load('src/upstream/transforms.ts')
  const module = 'store/profile.ts'
  const output = transformRenderer(readFileSync(path.join(root, '../desktop/src', module), 'utf8'), `/desktop/src/${module}`).code
  const selector = initializer(output, '$profileScope')
  for (const presentation of [false, true]) for (const all of [false, true]) for (const active of ['default', 'writer', 'research']) {
    const scope = vm.runInNewContext(selector, {
      ALL_PROFILES: '__all__', $browserPresentationMode: presentation,
      $showAllProfiles: all, $activeGatewayProfile: active,
      normalizeProfileKey: value => value || 'default', computed: (values, project) => project(...values)
    })
    assert.equal(scope, presentation || all ? '__all__' : active)
  }
})

test('presentation mode switches scope and grouping without changing standard preferences', () => {
  const { useBrowserSessionPresentation } = load('src/upstream/browser-plugin.ts')
  const source = readFileSync(path.join(root, '../desktop/src/store/layout.ts'), 'utf8')
  const selector = initializer(useBrowserSessionPresentation(source, 'store'), '$sidebarGrouping')
  for (const presentation of [false, true]) for (const all of [false, true]) for (const grouped of [false, true]) {
    assert.equal(vm.runInNewContext(selector, {
      $browserPresentationMode: presentation, $sidebarAgentsGrouped: grouped, $showAllProfiles: all,
      $sidebarFlatGrouping: 'date', $sidebarAllProfilesGrouping: 'status', computed: (values, project) => project(...values)
    }), presentation ? 'profile' : grouped ? 'project' : all ? 'status' : 'date')
  }
  let enabled = false, notify
  const { $browserPresentationMode } = load('src/platform/session-presentation.ts', () => ({
    atom: initial => ({ value: initial, set(value) { this.value = value } }),
    browserPreference: () => ({ read: () => enabled, subscribe: callback => { notify = callback } })
  }))
  assert.equal($browserPresentationMode.value, false)
  enabled = true
  notify()
  assert.equal($browserPresentationMode.value, true)
  enabled = false
  notify()
  assert.equal($browserPresentationMode.value, false)
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
  assert.match(output, /!group.connectionId \|\| presentationMode/)
  assert.equal(ts.createSourceFile(module, output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0)
  assert.throws(() => useBrowserProfileSectionPictures(source.replace('name={group.profile}', 'name={other}'), root), /boundary changed/)
  const element = (type, props) => ({ type, props })
  let enabled = true
  const { useBrowserProfileSection } = load('src/upstream/profile-section.tsx', () => ({
    useBrowserPreference: () => enabled,
    useBrowserProfiles: () => ({ items: [{ key: 'research', label: 'Researcher', botName: 'Research', appearance: { color: 'blue', image: 'https://example.invalid/profile.png', shape: 'circle' } }] }),
    jsx: element, jsxs: element, avatarColor: color => color, BotFace: 'face'
  }))
  assert.equal(useBrowserProfileSection('research').label, 'Researcher')
  assert.equal(useBrowserProfileSection('research').picture.props.children.props.image, 'https://example.invalid/profile.png')
  assert.equal(useBrowserProfileSection('unknown').label, 'unknown')
  enabled = false
  assert.equal(useBrowserProfileSection('research'), null)
})
