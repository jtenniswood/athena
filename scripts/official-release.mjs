import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { rendererLock } from './renderer.mjs'

export function readOfficialRelease() {
  const release = JSON.parse(readFileSync(new URL('../hermes-release.json', import.meta.url), 'utf8'))
  if (!/^v\d+\.\d+\.\d+$/.test(release.version) || release.revision !== rendererLock().rev ||
      !/^nousresearch\/hermes-agent@sha256:[a-f0-9]{64}$/.test(release.gatewayImage || '')) {
    throw new Error('Pin the renderer to the recorded official Hermes release.')
  }
  return release
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const release = readOfficialRelease()
  console.log(`Official Hermes renderer ${release.version}: ${release.revision}`)
}
