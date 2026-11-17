import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
test('automatic main development builds publish only development tags without deployment', () => {
  const publication = imagePublication({ ...input, ref: 'refs/heads/main', event: 'push', developmentOnly: true })
  assert.deepEqual(publication, {
    image, channel: 'development', deploy: false,
    tags: [`${image}:dev-latest`, `${image}:dev-sha-${revision}`]
  })
  for (const ref of ['refs/heads/codex/feature', 'refs/tags/v1.2.3', 'refs/pull/1/merge']) {
    assert.throws(() => imagePublication({ ...input, ref, event: 'push', developmentOnly: true }))
  }
  assert.throws(() => imagePublication({ ...input, ref: 'refs/heads/main', event: 'push' }))
  assert.throws(() => imagePublication({ ...input, ref: 'refs/heads/main', event: 'pull_request', developmentOnly: true }))
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

test('the publication artifact pins the build digest and the checked renderer release', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'athena-publication-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const script = new URL('./record-image-publication.mjs', import.meta.url)
  const release = JSON.parse(readFileSync(new URL('../hermes-release.json', import.meta.url), 'utf8'))
  const digest = 'sha256:' + 'e'.repeat(64)
  const summary = path.join(directory, 'summary')
  const fixture = path.join(directory, 'expected-build-info.json')
  const commands = path.join(directory, 'docker-commands')
  const docker = path.join(directory, 'docker')
  const built = { wrapperRevision: revision, rendererRevision: release.revision, hermesRelease: release.version, channel: 'development' }
  writeFileSync(fixture, JSON.stringify(built))
  writeFileSync(docker, `#!/bin/sh
printf '%s\n' "$*" >> "$DOCKER_COMMANDS"
case "$1" in
  create) printf 'container-id\n' ;;
  cp) cp "$BUILD_INFO_FIXTURE" "$3" ;;
  rm) test "$2 $3" = '-v container-id' ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 })
  const env = {
    ...process.env, PATH: directory + path.delimiter + process.env.PATH,
    BUILD_INFO_FIXTURE: fixture, DOCKER_COMMANDS: commands, IMAGE: image, IMAGE_DIGEST: digest, GITHUB_SHA: revision,
    IMAGE_CHANNEL: 'development', GITHUB_STEP_SUMMARY: summary
  }
  execFileSync(process.execPath, [script.pathname], { cwd: directory, env })
  assert.deepEqual(JSON.parse(readFileSync(path.join(directory, 'image-publication.json'), 'utf8')), {
    image: image + '@' + digest, wrapperRevision: revision, channel: 'development',
    rendererRevision: release.revision, hermesRelease: release.version, gatewayFixtureImage: release.gatewayImage
  })
  assert.ok(readFileSync(summary, 'utf8').includes(image + '@' + digest))
  const artifact = path.join(directory, 'image-publication.json')
  rmSync(artifact)
  writeFileSync(fixture, JSON.stringify({ ...built, rendererRevision: 'b'.repeat(40) }))
  const run = () => execFileSync(process.execPath, [script.pathname], { cwd: directory, env, stdio: 'pipe' })
  assert.throws(run, error => error.stderr.toString().includes('does not match the expected rendererRevision'))
  assert.throws(() => readFileSync(artifact), { code: 'ENOENT' })
  const dockerCommands = readFileSync(commands, 'utf8').trim().split('\n')
  assert.deepEqual(dockerCommands.filter(command => command.startsWith('create ')), [
    `create --platform=linux/amd64 ${image}@${digest}`,
    `create --platform=linux/amd64 ${image}@${digest}`
  ])
  assert.equal(dockerCommands.filter(command => command === 'rm -v container-id').length, 2)
  assert.throws(() => execFileSync(process.execPath, [script.pathname], {
    cwd: directory, env: { ...env, IMAGE_DIGEST: 'latest' }, stdio: 'pipe'
  }))
})
