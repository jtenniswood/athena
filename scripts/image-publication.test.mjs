import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
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
  const script = path.join(directory, 'record.mjs')
  symlinkSync(new URL('./record-image-publication.mjs', import.meta.url), script)
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
  execFileSync(process.execPath, [script], { cwd: directory, env })
  assert.deepEqual(JSON.parse(readFileSync(path.join(directory, 'image-publication.json'), 'utf8')), {
    image: image + '@' + digest, wrapperRevision: revision, channel: 'development',
    rendererRevision: release.revision, hermesRelease: release.version, gatewayFixtureImage: release.gatewayImage
  })
  assert.ok(readFileSync(summary, 'utf8').includes(image + '@' + digest))
  const artifact = path.join(directory, 'image-publication.json')
  rmSync(artifact)
  writeFileSync(fixture, JSON.stringify({ ...built, rendererRevision: 'b'.repeat(40) }))
  const run = () => execFileSync(process.execPath, [script], { cwd: directory, env, stdio: 'pipe' })
  assert.throws(run, error => error.stderr.toString().includes('does not match the expected rendererRevision'))
  assert.throws(() => readFileSync(artifact), { code: 'ENOENT' })
  const dockerCommands = readFileSync(commands, 'utf8').trim().split('\n')
  assert.deepEqual(dockerCommands.filter(command => command.startsWith('create ')), [
    `create --platform=linux/amd64 ${image}@${digest}`,
    `create --platform=linux/amd64 ${image}@${digest}`
  ])
  assert.equal(dockerCommands.filter(command => command === 'rm -v container-id').length, 2)
  assert.throws(() => execFileSync(process.execPath, [script], {
    cwd: directory, env: { ...env, IMAGE_DIGEST: 'latest' }, stdio: 'pipe'
  }))
})


test('running image verification checks both the registry digest and HTTP build identity', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'athena-running-image-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const snapshot = path.join(directory, 'snapshot')
  const digests = path.join(directory, 'digests')
  const artifact = path.join(directory, 'image-publication.json')
  const imageId = 'sha256:' + 'c'.repeat(64)
  const reference = image + '@sha256:' + 'd'.repeat(64)
  const record = { image: reference, wrapperRevision: revision,
    rendererRevision: 'b'.repeat(40), hermesRelease: 'v1.2.3', channel: 'development' }
  writeFileSync(artifact, JSON.stringify(record))
  writeFileSync(snapshot, 'container ' + imageId + ' true first')
  writeFileSync(digests, JSON.stringify([reference]))
  writeFileSync(path.join(directory, 'docker'), `#!/bin/sh
case "$1 $2" in
  'container inspect') test "$5" = athena && cat "$SNAPSHOT" ;;
  'image inspect') test "$5" = "$IMAGE_ID" && cat "$DIGESTS" ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 })

  let served = record
  let restart = false
  let requests = 0
  const server = createServer((request, response) => {
    assert.equal(request.url, '/build-info.json')
    requests++
    if (restart) writeFileSync(snapshot, 'container ' + imageId + ' true second')
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(served))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = 'http://127.0.0.1:' + server.address().port
  const script = path.join(directory, 'verify.mjs')
  symlinkSync(new URL('./verify-running-image.mjs', import.meta.url), script)
  const verify = () => promisify(execFile)(process.execPath, [script, artifact, 'athena', origin], {
    env: { ...process.env, PATH: directory + path.delimiter + process.env.PATH,
      SNAPSHOT: snapshot, DIGESTS: digests, IMAGE_ID: imageId }
  })
  assert.ok((await verify()).stdout.includes(reference))

  writeFileSync(digests, JSON.stringify([image + '@' + imageId]))
  await assert.rejects(verify, error => error.stderr.includes('does not match the published digest'))
  assert.equal(requests, 1)

  writeFileSync(digests, JSON.stringify([reference]))
  served = { ...record, wrapperRevision: 'e'.repeat(40) }
  await assert.rejects(verify, error => error.stderr.includes('does not match the expected wrapperRevision'))

  served = record
  restart = true
  await assert.rejects(verify, error => error.stderr.includes('container changed during the check'))
})
