import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { verifyBuildInfo } from './record-image-publication.mjs'

function docker(args) {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function inspectRunningContainer(container) {
  const snapshot = docker(['container', 'inspect', '--format', '{{.Id}} {{.Image}} {{.State.Running}} {{.State.StartedAt}}', container])
  const [, imageId, running] = snapshot.split(' ')
  if (running !== 'true' || !/^sha256:[0-9a-f]{64}$/.test(imageId)) {
    throw new Error('The selected container is not running a verifiable image')
  }
  return { snapshot, imageId }
}

export async function verifyRunningImage(record, container, origin) {
  if (!/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$/.test(record?.image) ||
      !/^[a-f0-9]{40}$/.test(record.wrapperRevision) || !/^[a-f0-9]{40}$/.test(record.rendererRevision) ||
      typeof record.hermesRelease !== 'string' || !record.hermesRelease || !['stable', 'development'].includes(record.channel)) {
    throw new Error('Invalid image publication record')
  }
  if (typeof container !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container)) throw new Error('Invalid Docker container name or ID')
  const url = new URL(origin)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use an Athena HTTP or HTTPS origin')
  }

  const before = inspectRunningContainer(container)
  const digests = JSON.parse(docker(['image', 'inspect', '--format', '{{json .RepoDigests}}', before.imageId]))
  if (!Array.isArray(digests) || !digests.includes(record.image)) {
    throw new Error('The running container image does not match the published digest')
  }

  const response = await fetch(new URL('/build-info.json', url), {
    signal: AbortSignal.timeout(10000), redirect: 'error', cache: 'no-store'
  })
  if (!response.ok) throw new Error('Athena build info returned HTTP ' + response.status)
  verifyBuildInfo(record, await response.json())
  if (inspectRunningContainer(container).snapshot !== before.snapshot) {
    throw new Error('The container changed during the check')
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [file, container, origin] = process.argv.slice(2)
    if (process.argv.length !== 5) throw new Error('Usage: node scripts/verify-running-image.mjs <image-publication.json> <container> <origin>')
    const record = JSON.parse(readFileSync(file, 'utf8'))
    await verifyRunningImage(record, container, origin)
    console.log('Running container and served build match ' + record.image)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
