import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function androidVersion(source) {
  const version = source.match(/versionName\s*=\s*"(\d+\.\d+\.\d+)"/)?.[1]
  const code = Number(source.match(/versionCode\s*=\s*(\d+)/)?.[1])
  if (!version || !Number.isSafeInteger(code) || code < 1) throw new Error('Invalid Android app version')
  return { version, code }
}
export function releaseIdentity({ tag, event, ref, source, commit, onMain }) {
  if (!/^android-v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Use an android-vMAJOR.MINOR.PATCH tag')
  if (event === 'workflow_dispatch' ? ref !== 'refs/heads/main' : event !== 'push' || ref !== `refs/tags/${tag}`)
    throw new Error('Android releases must run from main or an Android version tag')
  if (!onMain || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('The tagged commit must already belong to origin/main')
  const { version, code } = androidVersion(source)
  if (tag !== `android-v${version}`) throw new Error('Tag does not match the Android app version')
  return { tag, commit, version, code, filename: `athena-android-${version}.apk` }
}

export function verifyApkMetadata({ badging, certificates, expectedFingerprint, version, code }) {
  if (/^application-debuggable/m.test(badging)) throw new Error('A published APK must not be debuggable')
  const packageLine = badging.match(/^package:.*$/m)?.[0] || ''
  if (!packageLine.includes("name='com.athena.android'") || !packageLine.includes(`versionCode='${code}'`) ||
      !packageLine.includes(`versionName='${version}'`)) throw new Error('APK identity does not match the release')
  const fingerprints = [...certificates.matchAll(/certificate SHA-256 digest: ([a-f0-9]{64})/g)].map(match => match[1])
  if (fingerprints.length !== 1 || fingerprints[0] !== expectedFingerprint.trim()) throw new Error('APK signing identity changed')
  return fingerprints[0]
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
    if (process.argv[2] === 'identify') {
      const tag = process.env.RELEASE_TAG || ''
      if (!/^android-v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Invalid Android tag')
      const commit = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`)
      let onMain = false
      try { git('merge-base', '--is-ancestor', commit, 'origin/main'); onMain = true } catch { /* Reject unreviewed tags. */ }
      const identity = releaseIdentity({ tag, commit, onMain, event: process.env.GITHUB_EVENT_NAME,
        ref: process.env.GITHUB_REF, source: git('show', `${commit}:apps/android/app/build.gradle.kts`) })
      for (const [key, value] of Object.entries(identity)) writeFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`, { flag: 'a' })
    } else if (process.argv[2] === 'manifest') {
      const [apk, output] = process.argv.slice(3)
      const { version, code } = androidVersion(readFileSync('apps/android/app/build.gradle.kts', 'utf8'))
      const sdk = path.join(process.env.ANDROID_HOME, 'build-tools', '35.0.0')
      const certificates = execFileSync(path.join(sdk, 'apksigner'), ['verify', '--print-certs', apk], { encoding: 'utf8' })
      const badging = execFileSync(path.join(sdk, 'aapt2'), ['dump', 'badging', apk], { encoding: 'utf8' })
      const resources = execFileSync(path.join(sdk, 'aapt2'), ['dump', 'resources', apk], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      if (!resources.includes('string/google_app_id') || !resources.includes('string/gcm_defaultSenderId'))
        throw new Error('The release APK is missing Firebase configuration')
      const signingCertificateSha256 = verifyApkMetadata({ badging, certificates, version, code,
        expectedFingerprint: readFileSync('apps/android/release-signing.sha256', 'utf8') })
      const revision = process.env.ATHENA_ANDROID_BUILD_REVISION
      if (!/^[a-f0-9]{40}$/.test(revision) || git('rev-parse', 'HEAD') !== revision)
        throw new Error('A release must identify its checked-out source commit')
      git('diff', '--quiet', 'HEAD', '--', 'apps/android', 'scripts/android-release.mjs')
      writeFileSync(output, JSON.stringify({ schemaVersion: 1, version, versionCode: code,
        packageName: 'com.athena.android', firebaseConfigured: true, revision, bridgeProtocol: 1, minimumServerProtocol: 1,
        signingCertificateSha256, sha256: createHash('sha256').update(readFileSync(apk)).digest('hex') }, null, 2) + '\n')
    } else throw new Error('Use identify or manifest')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
