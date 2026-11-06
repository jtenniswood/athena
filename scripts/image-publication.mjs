import { appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Publication and deployment are separate decisions, shared by both publishers. */
export function imagePublication({ repository, revision, ref, event, developmentOnly = false, component = 'ui' }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid image repository or source revision')
  if (!['ui', 'hermes'].includes(component)) throw new Error('Unknown image component')
  const image = `ghcr.io/${repository.toLowerCase()}${component === 'hermes' ? '-hermes' : ''}`
  const branch = /^refs\/heads\/.+/.test(ref)
  const version = /^refs\/tags\/v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(ref)?.[1]
  if (developmentOnly || (branch && ref !== 'refs/heads/main')) {
    const mainPush = developmentOnly && ref === 'refs/heads/main' && event === 'push'
    if (!branch || (event !== 'workflow_dispatch' && !mainPush)) throw new Error('Development publication requires a manual branch build or an automatic main build')
    return { image, channel: 'development', deploy: false, tags: [`${image}:dev-latest`, `${image}:dev-sha-${revision}`] }
  }
  if (ref === 'refs/heads/main' && event === 'workflow_dispatch') {
    return { image, channel: 'stable', deploy: true, tags: [`${image}:latest`, `${image}:sha-${revision}`, `${image}:main`] }
  }
  if (version && ['push', 'workflow_dispatch'].includes(event)) {
    return { image, channel: 'stable', deploy: false, tags: [`${image}:latest`, `${image}:sha-${revision}`, `${image}:${version}`] }
  }
  throw new Error('Stable publication requires a manual main build or a stable version tag')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const publication = imagePublication({
    repository: process.env.GITHUB_REPOSITORY, revision: process.env.GITHUB_SHA,
    ref: process.env.GITHUB_REF, event: process.env.GITHUB_EVENT_NAME,
    developmentOnly: process.argv.includes('--development'),
    component: process.argv.includes('--hermes') ? 'hermes' : 'ui'
  })
  if (process.argv.includes('--github-output')) {
    if (!process.env.GITHUB_OUTPUT) throw new Error('GitHub output file is missing')
    appendFileSync(process.env.GITHUB_OUTPUT, [
      `image=${publication.image}`, `channel=${publication.channel}`, `deploy=${publication.deploy}`,
      'tags<<ATHENA_IMAGE_TAGS', ...publication.tags, 'ATHENA_IMAGE_TAGS', ''
    ].join('\n'))
    if (process.argv.includes('--hermes')) {
      const release = JSON.parse(readFileSync(new URL('../hermes-release.json', import.meta.url), 'utf8'))
      if (!/^nousresearch\/hermes-agent@sha256:[a-f0-9]{64}$/.test(release.gatewayImage || '')) throw new Error('Pin the official Hermes image before publication')
      appendFileSync(process.env.GITHUB_OUTPUT, `upstream_image=${release.gatewayImage}\nupstream_revision=${release.revision}\n`)
    }
  } else console.log(JSON.stringify(publication, null, 2))
}
