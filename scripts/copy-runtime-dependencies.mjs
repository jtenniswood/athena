import { cpSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const [destination, ...packages] = process.argv.slice(2)
const root = process.cwd()
const copied = new Set()

function copy(name, from) {
  // Find the manifest even for packages that hide it behind an exports map.
  const require = createRequire(from)
  const directory = require.resolve.paths(name)
    .map(base => path.join(base, name))
    .find(candidate => {
      try { return JSON.parse(readFileSync(path.join(candidate, 'package.json'), 'utf8')).name === name }
      catch (error) { if (error.code !== 'ENOENT') throw error; return false }
    })
  if (!directory) throw new Error('Missing runtime dependency: ' + name)
  if (copied.has(directory)) return
  copied.add(directory)
  const manifest = path.join(directory, 'package.json')
  cpSync(directory, path.join(destination, path.relative(root, directory)), {
    recursive: true, filter: source => path.basename(source) !== 'node_modules'
  })
  for (const dependency of Object.keys(JSON.parse(readFileSync(manifest, 'utf8')).dependencies || {})) {
    copy(dependency, manifest)
  }
}

for (const name of packages) copy(name, path.join(root, 'package.json'))
