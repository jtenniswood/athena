import { stripTypeScriptTypes } from 'node:module'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Use the shipped bridge adapter in the real WebView test, without installing the full web toolchain.
const source = readFileSync(new URL('../apps/web-desktop/src/platform/android.ts', import.meta.url), 'utf8')
const destination = process.argv[2]
if (!destination || path.resolve(destination) === fileURLToPath(import.meta.url)) throw new Error('Provide a generated test asset path')
mkdirSync(path.dirname(destination), { recursive: true })
writeFileSync(destination, stripTypeScriptTypes(source, { mode: 'strip' }))

const settings = readFileSync(new URL('../apps/web-desktop/src/upstream/native-settings.ts', import.meta.url), 'utf8')
const presentation = readFileSync(new URL('../apps/web-desktop/src/platform/settings-presentation.ts', import.meta.url), 'utf8')
writeFileSync(path.join(path.dirname(destination), 'native-settings.js'), stripTypeScriptTypes(presentation, { mode: 'strip' }) + '\n' + stripTypeScriptTypes(settings, { mode: 'strip' })
  .replace(/^import\s+\{[^}]+\}\s+from\s+['"]\.\.\/platform\/settings-presentation['"];?\s*$/m, '')
  .replace("'../platform/android'", "'./android-adapter.js'"))
