import { appendFileSync, writeFileSync } from 'node:fs'
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { IMAGE, IMAGE_DIGEST, IMAGE_CHANNEL, GITHUB_SHA, GITHUB_STEP_SUMMARY } = process.env
  const identity = publishedImageIdentity({
    image: IMAGE, digest: IMAGE_DIGEST, wrapperRevision: GITHUB_SHA, channel: IMAGE_CHANNEL,
    release: readOfficialRelease()
  })
  writeFileSync('image-publication.json', JSON.stringify(identity, null, 2) + '\n')
  if (GITHUB_STEP_SUMMARY) {
    appendFileSync(GITHUB_STEP_SUMMARY, [
      '### Published Athena image', '', `- Image: \`${identity.image}\``,
      `- Athena: \`${identity.wrapperRevision}\` (${identity.channel})`,
      `- Hermes renderer: \`${identity.hermesRelease}\` (\`${identity.rendererRevision}\`)`, ''
    ].join('\n'))
  }
}
