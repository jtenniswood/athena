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

test('the combined session scope survives saved profile choices and opening another profile', () => {
  const { transformRenderer } = load('src/upstream/transforms.ts')
  const module = 'store/profile.ts'
  const source = readFileSync(path.join(root, '../desktop/src', module), 'utf8')
  const output = transformRenderer(source, `/desktop/src/${module}`).code
  const parsed = ts.createSourceFile(module, output, ts.ScriptTarget.Latest, true)
  const declaration = parsed.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(parsed) === '$profileScope'))
  const initializer = declaration.declarationList.declarations[0].initializer.getText(parsed)
  for (const browser of [false, true]) for (const all of [false, true]) for (const active of ['default', 'writer', 'research']) {
    const scope = vm.runInNewContext(initializer, {
      window: { __HERMES_WEB_BRIDGE__: browser }, ALL_PROFILES: '__all__',
      $showAllProfiles: all, $activeGatewayProfile: active,
      normalizeProfileKey: value => value || 'default',
      computed: (values, project) => project(...values)
    })
    assert.equal(scope, browser || all ? '__all__' : active)
  }
  const actions = 'app/session/hooks/use-session-list-actions.ts'
  const refreshed = transformRenderer(readFileSync(path.join(root, '../desktop/src', actions), 'utf8'), `/desktop/src/${actions}`).code
  assert.doesNotMatch(refreshed, /__HERMES_WEB_ACTIVE_PROFILE__/)
  assert.match(refreshed, /sidebarProfileForScope\(profileScope\)/)
  assert.match(refreshed, /sidebarProfileForScope\(profileScopeRef.current\)/)
})

test('existing profile grouping and filters migrate once without resetting later choices', () => {
  const storage = new Map(), calls = []
  const { restoreUnifiedSessionList } = load('src/upstream/session-list.ts', () => ({
    setSidebarGrouping: grouping => calls.push(grouping),
    $sidebarProfileFilter: { set: profiles => calls.push(Array.from(profiles)) }
  }), { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } })
  restoreUnifiedSessionList()
  assert.deepEqual(calls, ['profile', []])
  restoreUnifiedSessionList()
  assert.equal(calls.length, 2)
})

test('the combined chat list has no profile selector footer', () => {
  const shell = readFileSync(path.join(root, 'src/experience/browser-shell.tsx'), 'utf8')
  assert.doesNotMatch(shell, /BrowserProfileNavigation/)
})

test('profile sections reuse configured pictures and keep exact owner routes', () => {
  const { useBrowserProfileSectionPictures } = load('src/upstream/browser-plugin.ts')
  const module = 'app/chat/sidebar/gateway-groups.tsx'
  const source = readFileSync(path.join(root, '../desktop/src', module), 'utf8')
  const output = useBrowserProfileSectionPictures(source, root)
  assert.match(output, /browserProfile\?\.picture/)
  assert.match(output, /browserProfile\?\.label/)
  assert.match(output, /newSessionInAgent\(\{ connectionId: group.connectionId, profile \}\)/)
  assert.match(output, /!group.connectionId \|\| window.__HERMES_WEB_BRIDGE__/)
  assert.equal(ts.createSourceFile(module, output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0)
  assert.throws(() => useBrowserProfileSectionPictures(source.replace('name={group.profile}', 'name={other}'), root), /boundary changed/)
  const element = (type, props) => ({ type, props })
  const { useBrowserProfileSection } = load('src/upstream/profile-section.tsx', () => ({
    useBrowserProfiles: () => ({ items: [{ key: 'research', label: 'Researcher', botName: 'Research', appearance: { color: 'blue', image: 'https://example.invalid/profile.png', shape: 'circle' } }] }),
    jsx: element, jsxs: element, avatarColor: color => color, BotFace: 'face'
  }))
  const section = useBrowserProfileSection('research')
  assert.equal(section.label, 'Researcher')
  assert.equal(section.picture.props.children.props.image, 'https://example.invalid/profile.png')
  assert.equal(useBrowserProfileSection('unknown').label, 'unknown')
  assert.equal(useBrowserProfileSection(undefined), null)
})
