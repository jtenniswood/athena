import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readOfficialRelease } from './official-release.mjs'

export function publishedImageIdentity({ image, digest, wrapperRevision, channel, release }) {
  if (!/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(image) ||
      !/^sha256:[a-f0-9]{64}$/.test(digest) ||
      !/^[a-f0-9]{40}$/.test(wrapperRevision) ||
      !['stable', 'development'].includes(channel)) {
    throw new Error('Invalid published image identity')
  }
  return {
    image: `${image}@${digest}`, wrapperRevision, channel, rendererRevision: release.revision,
    hermesRelease: release.version, gatewayFixtureImage: release.gatewayImage
  }
}

function inspectPublishedImage(reference) {
  const temporary = mkdtempSync(path.join(tmpdir(), 'athena-image-'))
  const buildInfo = path.join(temporary, 'build-info.json')
  let container
  try {
    // Resolve the immutable registry digest. The container is never started.
    container = execFileSync('docker', ['create', '--platform=linux/amd64', reference], { encoding: 'utf8' }).trim()
    execFileSync('docker', ['cp', container + ':/usr/share/nginx/html/build-info.json', buildInfo])
    return JSON.parse(readFileSync(buildInfo, 'utf8'))
  } finally {
    try {
      if (container) execFileSync('docker', ['rm', '-v', container])
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  }
}

export function verifyBuildInfo(identity, built) {
  for (const field of ['wrapperRevision', 'rendererRevision', 'hermesRelease', 'channel']) {
    if (built?.[field] !== identity[field]) throw new Error(`Published build-info.json does not match the expected ${field}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { IMAGE, IMAGE_DIGEST, IMAGE_CHANNEL, GITHUB_SHA, GITHUB_STEP_SUMMARY } = process.env
  const identity = publishedImageIdentity({
    image: IMAGE, digest: IMAGE_DIGEST, wrapperRevision: GITHUB_SHA, channel: IMAGE_CHANNEL,
    release: readOfficialRelease()
  })
  verifyBuildInfo(identity, inspectPublishedImage(identity.image))
  writeFileSync('image-publication.json', JSON.stringify(identity, null, 2) + '\n')
  if (GITHUB_STEP_SUMMARY) {
    appendFileSync(GITHUB_STEP_SUMMARY, [
      '### Published Athena image', '', `- Image: \`${identity.image}\``,
      `- Athena: \`${identity.wrapperRevision}\` (${identity.channel})`,
      `- Hermes renderer: \`${identity.hermesRelease}\` (\`${identity.rendererRevision}\`)`, ''
    ].join('\n'))
  }
}
