import path from 'node:path'
import ts from 'typescript'

/** Extract the renderer's existing page/control lifecycle, without generating a browser frame. */
export function useBrowserSettingsController(source: string, root: string): string {
  const replacements = [
    ["useRouteEnumParam('tab', SETTINGS_VIEWS, 'config:model' as SettingsViewId)", 'useBrowserSettingsDestination(SETTINGS_VIEWS)'],
    ['const subpage = resolveSettingsSubpage(activeView, params)', 'const subpage = browserSettingsSubpage(activeView, params, resolveSettingsSubpage)'],
    ['const destination = page ?? settingsSubpages(view)[0]?.id', 'const destination = page ?? browserSettingsDefaultSubpage(view, settingsSubpages(view))'],
    ['const children = settingsSubpages(view)', 'const children = browserSettingsChildren(view, settingsSubpages(view))'],
    ['getHermesConfigRecord()', 'getHermesConfigRecord(scopeProfile)'],
    ['saveHermesConfig(await getHermesConfigDefaults())', 'saveHermesConfig(await getHermesConfigDefaults(), scopeProfile)'],
    ['title: t.settings.resetConfirm', 'title: `${t.settings.resetConfirm} — ${scopeProfile}`']
  ] as const
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error(`Renderer settings controller contract changed: ${before}`)
    source = source.replace(before, after)
  }
  const input = ts.createSourceFile('settings-controller.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const settings = input.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'SettingsView') as ts.FunctionDeclaration | undefined
  if (!settings?.body) throw new Error('Renderer settings controller is missing')
  const statement = (text: string) => {
    const node = ts.createSourceFile('statement.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).statements[0]
    const synthesize = (child: ts.Node) => { ts.setTextRange(child, { pos: -1, end: -1 }); ts.forEachChild(child, synthesize) }
    synthesize(node)
    return node
  }
  const configuration = statement(`const configurationCommands = createBrowserConfigurationCommands(
    { export: t.settings.exportConfig, import: t.settings.importConfig, reset: t.settings.resetToDefaults },
    { export: exportConfig, import: () => { triggerHaptic('open'); importInputRef.current?.click() }, reset: resetConfig }
  )`)
  const returned = statement(`return {
    activeView, navGroups, content: activeSettingsContent, openSettingsPage,
    needsSubpageRedirect, redirect: { hash, pathname, search: '?' + subpageSearch },
    labels: { back: t.common.back, close: t.settings.closeSettings, title: t.commandCenter.settings },
    search: { label: t.settings.search.pill, hint: searchCombo ? formatCombo(searchCombo) : '',
      active: paletteOpen, open: () => { triggerHaptic('open'); openCommandPalettePage('settings') } }
  }`)
  const statements: ts.Statement[] = []
  let content = false
  for (const node of settings.body.statements) {
    if (ts.isReturnStatement(node)) continue
    if (ts.isVariableStatement(node)) {
      const names = node.declarationList.declarations.map(declaration => declaration.name.getText(input))
      if (names.some(name => ['navFooter', 'searchPill', 'activeGroup', 'activeChild'].includes(name))) continue
      if (names.includes('SubpageView')) statements.push(configuration)
      if (names.includes('activeSettingsContent')) content = true
    }
    statements.push(node)
  }
  if (!content) throw new Error('Renderer settings page content contract changed')
  statements.push(returned)
  const injectConfigProps: ts.TransformerFactory<ts.Node> = context => {
    const visit: ts.Visitor = node => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(input) === 'ConfigSettings') {
        const props = ['configurationCommands', 'configurationScopeProfile'].map((name, index) =>
          ts.factory.createJsxAttribute(ts.factory.createIdentifier(name), ts.factory.createJsxExpression(undefined, ts.factory.createIdentifier(index ? 'scopeProfile' : name))))
        return ts.factory.updateJsxSelfClosingElement(node, node.tagName, node.typeArguments,
          ts.factory.createJsxAttributes([...node.attributes.properties, ...props]))
      }
      return ts.visitEachChild(node, visit, context)
    }
    return node => ts.visitNode(node, visit) as ts.Node
  }
  const controller = ts.factory.updateFunctionDeclaration(settings, settings.modifiers, settings.asteriskToken,
    ts.factory.createIdentifier('useRendererSettingsController'), settings.typeParameters, settings.parameters, settings.type,
    ts.factory.createBlock(statements, true))
  const transformed = ts.transform(controller, [injectConfigProps])
  const updated = input.statements.flatMap(node => {
    if (node === settings) return [transformed.transformed[0] as ts.Statement]
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.some(item => item.propertyName?.text === 'SettingsView')) return []
    return [node]
  })
  const output = ts.createPrinter().printFile(ts.factory.updateSourceFile(input, updated))
  transformed.dispose()
  return [
    `import { useBrowserSettingsDestination, browserSettingsSubpage, browserSettingsDefaultSubpage, browserSettingsChildren } from ${JSON.stringify(path.join(root, 'src/experience/settings/route-policy'))}`,
    `import { createBrowserConfigurationCommands } from ${JSON.stringify(path.join(root, 'src/experience/settings/configuration'))}`,
    "import { formatCombo } from '@/lib/keybinds/combo'", output
  ].join('\n')
}
