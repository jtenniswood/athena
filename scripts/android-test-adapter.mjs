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
