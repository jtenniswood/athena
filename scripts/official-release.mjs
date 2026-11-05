import { readFileSync } from 'node:fs'
import { rendererLock } from './renderer.mjs'

const release = JSON.parse(readFileSync(new URL('../hermes-release.json', import.meta.url), 'utf8'))
if (!/^v\d+\.\d+\.\d+$/.test(release.version) || release.revision !== rendererLock().rev ||
    !/^nousresearch\/hermes-agent@sha256:[a-f0-9]{64}$/.test(release.image)) {
  throw new Error('Pin the official Hermes release source and image together.')
}
const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')
if (!dockerfile.includes(`FROM ${release.image} AS runtime`)) throw new Error('Dockerfile does not use the pinned official image.')
console.log(`Official Hermes ${release.version}: ${release.revision}`)
