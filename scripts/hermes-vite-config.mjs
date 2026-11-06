import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

/** Reuse the official browser's pure build options without executing native plugins or writing into fetched sources. */
export function rendererBuildOptions(source) {
  const file = ts.createSourceFile('vite.config.ts', source, ts.ScriptTarget.Latest, true)
  let options
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'defineConfig') {
      let value = node.arguments[0]
      if (ts.isArrowFunction(value)) value = value.body
      if (ts.isParenthesizedExpression(value)) value = value.expression
      if (ts.isObjectLiteralExpression(value)) options = value
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (!options) throw new Error('Review the official Hermes Vite configuration shape.')
  const result = {}
  for (const name of ['build', 'css', 'optimizeDeps']) {
    const property = options.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText(file) === name)
    if (!property) throw new Error(`Missing official Hermes build option: ${name}`)
    const literal = property.initializer.getText(file)
    // These sections currently contain literals, arrays, objects and regular expressions only.
    let executable = false
    const check = node => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isFunctionLike(node) || ts.isSpreadAssignment(node) || ts.isPropertyAccessExpression(node)) executable = true
      ts.forEachChild(node, check)
    }
    check(property.initializer)
    if (executable) throw new Error(`Review executable official Hermes build options: ${name}`)
    const normalize = value => {
      if (value?.constructor?.name === 'RegExp') return new RegExp(value.source, value.flags)
      if (Array.isArray(value)) return Array.from(value, normalize)
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]))
      return value
    }
    result[name] = normalize(vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 100 }))
  }
  return result
}

export function officialRendererBuildOptions() {
  return rendererBuildOptions(readFileSync(new URL('../apps/desktop/vite.config.ts', import.meta.url), 'utf8'))
}
