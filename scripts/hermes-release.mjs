import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const repository = 'NousResearch/hermes-agent'
const sha = value => /^[a-f0-9]{40}$/.test(value || '')

export function validateRelease(release) {
  if (!/^v\d+\.\d+\.\d+$/.test(release.tag_name || '') || release.draft || release.prerelease) {
    throw new Error('Select a published stable Hermes release.')
  }
  return release.tag_name
}

export async function resolveRelease({ version, api }) {
  const release = await api(version ? `releases/tags/${encodeURIComponent(version)}` : 'releases/latest')
  const tag = validateRelease(release)
  let object = (await api(`git/ref/tags/${encodeURIComponent(tag)}`)).object
  for (let depth = 0; object?.type === 'tag' && depth < 8; depth++) object = (await api(`git/tags/${object.sha}`)).object
  if (object?.type !== 'commit' || !sha(object.sha)) throw new Error('The release tag does not resolve to a commit.')
  return { version: tag, revision: object.sha }
}

export function applyRelease(lock, release, metadata) {
  const previous = lock.nodes?.hermes?.locked
  const candidate = metadata.locked
  if (previous?.owner !== 'NousResearch' || previous.repo !== 'hermes-agent' || previous.type !== 'github' ||
      candidate?.rev !== release.revision || candidate.owner !== previous.owner || candidate.repo !== previous.repo ||
      candidate.type !== 'github' || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(candidate.narHash || '') ||
      !Number.isSafeInteger(candidate.lastModified) || candidate.lastModified <= 0) {
    throw new Error('Nix metadata does not match the verified Hermes release.')
  }
  const next = structuredClone(lock)
  for (const key of ['rev', 'narHash', 'lastModified']) next.nodes.hermes.locked[key] = candidate[key]
  return next
}

export async function resolveTestGatewayImage(version, request = globalThis.fetch) {
  const repository = 'nousresearch/hermes-agent'
  const auth = await request(`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`)
  if (!auth.ok) throw new Error('Cannot resolve the official gateway fixture registry token.')
  const { token } = await auth.json()
  const response = await request(`https://registry-1.docker.io/v2/${repository}/manifests/${version}`, {
    method: 'HEAD', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json' }
  })
  const digest = response.headers.get('docker-content-digest')
  if (!response.ok || !/^sha256:[a-f0-9]{64}$/.test(digest || '')) throw new Error('The official stable gateway image is not published yet. Retry after its release build completes.')
  return `${repository}@${digest}`
}

async function main() {
  const args = process.argv.slice(2)
  const version = args.find(arg => !arg.startsWith('--'))
  if (args.some(arg => arg.startsWith('--') && !['--check', '--dry-run'].includes(arg))) throw new Error('Usage: pnpm update:hermes [vX.Y.Z] [--check | --dry-run]')
  const api = async endpoint => JSON.parse(execFileSync('gh', ['api', `repos/${repository}/${endpoint}`], { encoding: 'utf8' }))
  const release = await resolveRelease({ version, api })
  const current = JSON.parse(readFileSync(path.join(root, 'hermes-release.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(path.join(root, 'flake.lock'), 'utf8'))
  console.log(`Hermes ${current.version} (${current.revision}) → ${release.version} (${release.revision})`)
  if (current.version === release.version && current.revision === release.revision && lock.nodes.hermes.locked.rev === release.revision) {
    console.log('Already on this stable release.')
    return
  }
  console.log(`Review: https://github.com/${repository}/compare/${current.revision}...${release.revision}`)
  if (args.includes('--check') || args.includes('--dry-run')) return
  release.testGatewayImage = await resolveTestGatewayImage(release.version)
  const metadata = JSON.parse(execFileSync('nix', ['--extra-experimental-features', 'nix-command flakes', 'flake', 'metadata', '--json', '--no-write-lock-file', `github:${repository}/${release.revision}`], { encoding: 'utf8' }))
  const next = applyRelease(lock, release, metadata)
  writeFileSync(path.join(root, 'flake.lock'), JSON.stringify(next, null, 2) + '\n')
  writeFileSync(path.join(root, 'hermes-release.json'), JSON.stringify(release, null, 2) + '\n')
  console.log('Updated both release pins. Prepare the renderer in a fresh checkout, review dependency and source changes, then run the release checks. No server, PR, merge or deployment was changed.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
