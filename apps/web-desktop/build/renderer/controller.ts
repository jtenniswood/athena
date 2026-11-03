import ts from 'typescript'

/** Keep renderer hooks and commands, replacing only a named controller's view. */
export function projectRendererController(source: string, name: string, view: string, omitBindings: readonly string[] = []): string {
  const tree = ts.createSourceFile('renderer-controller.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const functions = tree.statements.filter(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name)
  if (functions.length !== 1) throw new Error(`Renderer controller changed: ${name}`)
  const controller = functions[0] as ts.FunctionDeclaration
  const returns = controller.body?.statements.filter(ts.isReturnStatement) ?? []
  if (returns.length !== 1 || !returns[0].expression) throw new Error(`Renderer controller return changed: ${name}`)
  const edits = [{ start: returns[0].getStart(tree), end: returns[0].end, text: `return ${view}` }]
  for (const binding of omitBindings) {
    const declarations = controller.body!.statements.filter(statement => ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.length === 1 && statement.declarationList.declarations[0].name.getText(tree) === binding)
    if (declarations.length !== 1) throw new Error(`Renderer presentation binding changed: ${name}.${binding}`)
    edits.push({ start: declarations[0].getStart(tree), end: declarations[0].end, text: '' })
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end)
  return source
}
