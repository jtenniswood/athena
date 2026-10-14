import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { imagePublication } from './image-publication.mjs'

const revision = 'a'.repeat(40), image = 'ghcr.io/jtenniswood/athena'
const input = { repository: 'jtenniswood/Athena', revision, event: 'workflow_dispatch' }
test('any manual feature branch publishes development tags without stable tags or deployment', () => {
  for (const ref of ['refs/heads/codex/feature', 'refs/heads/renovate/dependency', 'refs/heads/main-fix']) {
    assert.deepEqual(imagePublication({ ...input, ref }), {
      image, channel: 'development', deploy: false,
      tags: [`${image}:dev-latest`, `${image}:dev-sha-${revision}`]
    })
  }
})
test('main stable publication requests deployment; a stable version publishes without deploying', () => {
  const main = imagePublication({ ...input, ref: 'refs/heads/main' })
  assert.equal(main.channel, 'stable'); assert.equal(main.deploy, true)
  assert.deepEqual(main.tags, [`${image}:latest`, `${image}:sha-${revision}`, `${image}:main`])
  const release = imagePublication({ ...input, event: 'push', ref: 'refs/tags/v1.2.3' })
  assert.equal(release.deploy, false)
  assert.deepEqual(release.tags, [`${image}:latest`, `${image}:sha-${revision}`, `${image}:1.2.3`])
})
test('the development publisher keeps even main builds out of stable tags', () => {
  const publication = imagePublication({ ...input, ref: 'refs/heads/main', developmentOnly: true })
  assert.equal(publication.channel, 'development'); assert.equal(publication.deploy, false)
  assert.ok(publication.tags.every(tag => tag.startsWith(`${image}:dev-`)))
  assert.throws(() => imagePublication({ ...input, ref: 'refs/tags/v1.2.3', developmentOnly: true }))
})
test('unapproved events and malformed or prerelease version tags cannot change stable channels', () => {
  for (const ref of ['refs/pull/1/merge', 'refs/tags/v1.2.3-beta', 'refs/tags/v01.2.3', 'refs/tags/v1.2', 'refs/tags/vanything']) {
    assert.throws(() => imagePublication({ ...input, ref }))
  }
  assert.throws(() => imagePublication({ ...input, ref: 'refs/heads/main', event: 'pull_request' }))
  assert.throws(() => imagePublication({ ...input, repository: 'owner/repo\ninjected', ref: 'refs/heads/main' }))
})
test('workflow outputs and both actual workflow callers use the same publication policy', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'athena-publication-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const output = path.join(directory, 'outputs')
  execFileSync(process.execPath, ['scripts/image-publication.mjs', '--github-output'], { env: {
    ...process.env, GITHUB_REPOSITORY: input.repository, GITHUB_SHA: revision,
    GITHUB_REF: 'refs/heads/codex/feature', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_OUTPUT: output
  } })
  const text = readFileSync(output, 'utf8')
  assert.ok(text.includes('channel=development\ndeploy=false'))
  assert.ok(!text.includes(`${image}:latest`))
  for (const workflow of ['release.yml', 'dev-image.yml']) {
    const source = readFileSync(new URL(`../.github/workflows/${workflow}`, import.meta.url), 'utf8')
    assert.match(source, /node scripts\/image-publication\.mjs --github-output/)
    assert.match(source, /HERMES_RELEASE_CHANNEL=\$\{\{ steps.identity.outputs.channel \}\}/)
    assert.doesNotMatch(source, /echo .*:latest/)
  }
})
