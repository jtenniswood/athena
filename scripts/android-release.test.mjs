import assert from 'node:assert/strict'
import { test } from 'node:test'
import { androidVersion, releaseIdentity, verifyApkMetadata } from './android-release.mjs'

const source = 'versionCode = 5\nversionName = "0.2.0"'
const identity = { tag: 'android-v0.2.0', event: 'push', ref: 'refs/tags/android-v0.2.0', source, commit: 'a'.repeat(40), onMain: true }
test('Android releases require a matching version tag already reviewed on main', () => {
  assert.equal(releaseIdentity(identity).filename, 'athena-android-0.2.0.apk')
  for (const changes of [{ onMain: false }, { tag: 'v0.2.0' }, { tag: 'android-v0.3.0', ref: 'refs/tags/android-v0.3.0' },
    { event: 'workflow_dispatch', ref: 'refs/heads/feature' }, { commit: 'bad' }]) {
    assert.throws(() => releaseIdentity({ ...identity, ...changes }))
  }
  assert.equal(releaseIdentity({ ...identity, event: 'workflow_dispatch', ref: 'refs/heads/main' }).code, 5)
  assert.throws(() => androidVersion('versionName = "dev"'))
})
test('release verification rejects an APK with a different package, version or signing key', () => {
  const apk = { badging: "package: name='com.athena.android' versionCode='5' versionName='0.2.0'", version: '0.2.0', code: 5,
    certificates: 'Signer #1 certificate SHA-256 digest: ' + 'b'.repeat(64), expectedFingerprint: 'b'.repeat(64) }
  assert.equal(verifyApkMetadata(apk), 'b'.repeat(64))
  assert.throws(() => verifyApkMetadata({ ...apk, code: 6 }))
  assert.throws(() => verifyApkMetadata({ ...apk, badging: apk.badging + '\napplication-debuggable' }))
  assert.throws(() => verifyApkMetadata({ ...apk, expectedFingerprint: 'c'.repeat(64) }))
  assert.throws(() => verifyApkMetadata({ ...apk, badging: apk.badging.replace('com.athena.android', 'different.app') }))
})
