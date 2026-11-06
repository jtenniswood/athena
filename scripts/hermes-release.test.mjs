import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyRelease, resolveRelease, resolveTestGatewayImage, validateRelease } from './hermes-release.mjs'

test('release resolution peels annotated tags and ignores the moving target branch', async () => {
  const revision = 'a'.repeat(40)
  const replies = {
    'releases/latest': { tag_name: 'v0.23.0', target_commitish: 'main', draft: false, prerelease: false },
    'git/ref/tags/v0.23.0': { object: { type: 'tag', sha: 'b'.repeat(40) } },
    [`git/tags/${'b'.repeat(40)}`]: { object: { type: 'commit', sha: revision } }
  }
  assert.deepEqual(await resolveRelease({ api: async route => replies[route] }), { version: 'v0.23.0', revision })
  for (const value of [{ tag_name: 'main' }, { tag_name: 'v1.0.0', prerelease: true }, { tag_name: 'v1.0.0', draft: true }]) assert.throws(() => validateRelease(value))
})

test('the separate gateway fixture resolves an immutable official image and fails before publication', async () => {
  const calls = [], digest = 'sha256:' + 'b'.repeat(64)
  const request = async (url, options) => {
    calls.push({ url, options })
    return url.startsWith('https://auth.docker.io/') ? Response.json({ token: 'public-pull-fixture' })
      : new Response(null, { headers: { 'docker-content-digest': digest } })
  }
  assert.equal(await resolveTestGatewayImage('v0.23.0', request), 'nousresearch/hermes-agent@' + digest)
  assert.equal(calls[1].options.method, 'HEAD')
  assert.ok(calls[1].url.endsWith('/manifests/v0.23.0'))
  await assert.rejects(resolveTestGatewayImage('v0.23.0', async url => url.startsWith('https://auth.docker.io/')
    ? Response.json({ token: 'public-pull-fixture' }) : new Response(null, { status: 404 })), /not published yet/)
})

test('release metadata must match the exact repository and preserves unrelated lock data', () => {
  const release = { version: 'v0.23.0', revision: 'a'.repeat(40) }
  const locked = { type: 'github', owner: 'NousResearch', repo: 'hermes-agent', rev: release.revision, narHash: 'sha256-' + 'A'.repeat(43) + '=', lastModified: 123 }
  const lock = { nodes: { hermes: { locked: { ...locked, rev: 'b'.repeat(40) }, original: { ref: 'main' } }, other: { untouched: true } } }
  const next = applyRelease(lock, release, { locked })
  assert.equal(next.nodes.hermes.locked.rev, release.revision)
  assert.equal(lock.nodes.hermes.locked.rev, 'b'.repeat(40))
  assert.deepEqual(next.nodes.other, lock.nodes.other)
  assert.deepEqual(next.nodes.hermes.original, lock.nodes.hermes.original)
  assert.throws(() => applyRelease(lock, release, { locked: { ...locked, rev: 'c'.repeat(40) } }))
  assert.throws(() => applyRelease(lock, release, { locked: { ...locked, repo: 'different' } }))
})
