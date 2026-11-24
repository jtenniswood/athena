import path from 'node:path'
import type { Plugin } from 'vite'
import names from './names.json' with { type: 'json' }
import outlines from './outlined-paths.json' with { type: 'json' }

const sheet = 'virtual:athena-material-icons.css'
const libraries: Readonly<Record<string, Record<string, string>>> = {
  '@tabler/icons-react': names.tabler,
  'lucide-react': names.lucide
}
const paths: Readonly<Record<string, string>> = outlines

// Connector and platform icons identify real products and keep their original marks.
const brandCodicons = [
  'github', 'github-action', 'github-alt', 'github-inverted', 'github-project',
  'twitter', 'vscode', 'vscode-insiders'
]

function iconMask(symbol: string): string {
  const glyph = paths[symbol]
  if (!glyph) throw new Error(`Material Symbol path missing: ${symbol}`)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${glyph}"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

function materialStyles(): string {
  const selectors = new Map<string, string[]>()
  for (const [name, symbol] of Object.entries(names.codicon)) {
    const group = selectors.get(symbol) ?? []
    group.push(`.codicon-${name}`)
    selectors.set(symbol, group)
  }
  const originalSelectors = [...brandCodicons, 'undefined'].map(name => `.codicon-${name}`).join(', ')
  return `
:root .codicon[class*="codicon-"]:not(:is(${originalSelectors}))::before {
  content: "";
  display: inline-block;
  vertical-align: top;
  width: 1em;
  height: 1em;
  background: currentColor;
  mask: var(--athena-icon, ${iconMask(names.fallback)}) center / contain no-repeat;
}
${[...selectors].map(([symbol, group]) => `${group.join(', ')} { --athena-icon: ${iconMask(symbol)}; }`).join('\n')}
.browser-shell [data-browser-model-pill]::before { mask-image: ${iconMask('tune')}; }
.browser-shell [data-testid="reasoning-pill"]::before { mask-image: ${iconMask('psychology')}; }
`
}

// These renderer files draw standard controls inline instead of importing an icon library.
const inlineIcons: Readonly<Record<string, Array<[RegExp, string]>>> = {
  'components/find-bar.tsx': [
    [/<svg height="14" viewBox="0 0 16 16" width="14">\s*<path d="M4 10l4-4 4 4"[^>]*\/>\s*<\/svg>/, '<MaterialIcon symbol="keyboard_arrow_up" size={14} />'],
    [/<svg height="14" viewBox="0 0 16 16" width="14">\s*<path d="M4 6l4 4 4-4"[^>]*\/>\s*<\/svg>/, '<MaterialIcon symbol="keyboard_arrow_down" size={14} />'],
    [/<svg height="12" viewBox="0 0 12 12" width="12">[\s\S]*?<\/svg>/, '<MaterialIcon symbol="close" size={12} />']
  ],
  'app/chat/right-rail/preview-file.tsx': [
    [/<svg aria-hidden="true" className=\{cn\('size-16', className\)\} viewBox="0 0 64 64">[\s\S]*?<\/svg>/,
      '<MaterialIcon symbol="deployed_code" className={cn(\'size-16\', className)} />']
  ],
  'components/assistant-ui/thread/assistant-message.tsx': [
    [/<svg aria-hidden className=\{className\} fill="currentColor" height="20" viewBox="0 0 20 20" width="20">[\s\S]*?<\/svg>/,
      '<MaterialIcon symbol="error" className={className} size={20} />']
  ],
  'components/chat/vibe-hearts.tsx': [
    [/<svg fill="none" shapeRendering="crispEdges" viewBox="0 0 14 12"[^>]*>[\s\S]*?<\/svg>/,
      '<MaterialIcon symbol="favorite:filled" width="100%" height="100%" />']
  ]
}

const referenceEdits: Array<[RegExp, string]> = [
  [/referenceStyle\(type\)\.paths/, '[materialPathForCodicon(referenceStyle(type).codicon)]'],
  [/fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/, 'fill="currentColor"'],
  [/svg\.setAttribute\('fill', 'none'\)\s*svg\.setAttribute\('stroke', 'currentColor'\)\s*svg\.setAttribute\('stroke-linecap', 'round'\)\s*svg\.setAttribute\('stroke-linejoin', 'round'\)\s*svg\.setAttribute\('stroke-width', '2'\)/,
    "svg.setAttribute('fill', 'currentColor')"],
  [/fill="none"\s*stroke="currentColor"\s*strokeLinecap="round"\s*strokeLinejoin="round"\s*strokeWidth=\{2\}/, 'fill="currentColor"']
]

function applyIconEdits(code: string, edits: Array<[RegExp, string]>, module: string): string {
  for (const [pattern, replacement] of edits) {
    if (!pattern.test(code)) throw new Error(`Inline icon changed in ${module}: ${pattern}`)
    code = code.replace(pattern, replacement)
  }
  return code
}

export function materialIcons(root: string): Plugin {
  const component = JSON.stringify(path.join(root, 'src/overrides/material-icons/material-icon.tsx'))
  return {
    name: 'athena:material-icons',
    enforce: 'pre',
    resolveId(id) {
      if (id === sheet || Object.hasOwn(libraries, id)) return '\0' + id
      return null
    },
    load(id) {
      if (id === '\0' + sheet) return materialStyles()
      const library = id.slice(1)
      if (!id.startsWith('\0') || !Object.hasOwn(libraries, library)) return null
      const exports = Object.entries(libraries[library]).map(([name, symbol]) =>
        `export const ${name} = createMaterialIcon(${JSON.stringify(symbol)})`)
      if (library === '@tabler/icons-react') {
        exports.push("export { default as IconBrandSlack } from '@tabler/icons-react/dist/esm/icons/IconBrandSlack.mjs'")
      }
      return [`import { createMaterialIcon } from ${component}`, ...exports].join('\n')
    },
    transform(code, id) {
      const module = id.replaceAll('\\', '/').split('?')[0].split('/desktop/src/')[1]
      if (module === 'components/ui/tool-icon.tsx') {
        return `export { MaterialToolIcon as ToolIcon } from ${component}\nexport type { ToolIconProps } from ${component}`
      }
      if (module === 'components/assistant-ui/directive-text.tsx') {
        return applyIconEdits(code, referenceEdits, module) + `\nimport { materialPathForCodicon } from ${component}\n`
      }
      const edits = inlineIcons[module]
      if (edits) return applyIconEdits(code, edits, module) + `\nimport { MaterialIcon } from ${component}\n`
      return null
    }
  }
}
