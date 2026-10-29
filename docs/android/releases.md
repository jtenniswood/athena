# Android APK releases

Android lives in this repository with the web interface and server adapters. Its
release channel is separate from Docker images: `android-v0.2.0` identifies an APK;
`v...` continues to identify a Docker release. An Android tag never deploys a
server or changes its data volume.

## Build and publish

1. Update `versionName` and increase `versionCode` in
   `apps/android/app/build.gradle.kts` through a PR. Preserve the application ID
   and signing identity so Android can update the installed app without clearing
   its settings, cookies or web storage.
2. Merge after the Android and compatibility checks pass. Create and push
   `android-v<versionName>` on the reviewed main commit.
3. The **Android signed release** workflow validates that the tag matches the app
   version and its commit belongs to `origin/main`. It runs unit tests and release
   lint, builds a Firebase-configured APK, verifies its package/version and pinned
   signing certificate, then publishes it with `SHA256SUMS` and `build-info.json`.
4. Finish active replies and recordings. Download the APK from that Android release and install it over the existing
   Athena app. Do not uninstall first. Existing published assets are immutable;
   changed APKs need a new version. A manual rerun from `main` can use an existing
   Android tag, subject to the same source and version checks.

The provenance file records the source commit, app version/code, bridge/server
protocol requirements, signing certificate fingerprint and APK hash. App settings
also shows the APK source revision, web revision and WebView version so independent
APK and server updates can be diagnosed. The certificate fingerprint is public;
it is not the signing key.

## Latest APK on demand

Use the `athena-apk-build` project skill, or open **Actions → Build latest
Android APK → Run workflow** with `main` selected. The manual workflow builds
and signs the commit on `main` at dispatch time, runs unit tests and release lint,
and verifies the same package, Firebase configuration and pinned signing
certificate as a versioned release. It does not create a tag, publish a GitHub
release or deploy the server.

Download the `android-signed-apk` artifact from the completed run. It contains
`athena-android-latest.apk`, `SHA256SUMS` and `build-info.json`, and is retained
for 30 days. Each run has its own artifact; use its recorded source revision to
identify the APK. The skill downloads the files and checks their hashes and
revision before returning the APK.

The APK keeps the app version and version code from `main`. Android can install
it over an existing app signed with the same key and an equal or lower version
code; this is a manual update rather than an automatic version upgrade. If a
higher version code is already installed, increase the version through a PR
first. Do not uninstall to bypass that check, because uninstalling clears local
data. Use versioned releases when publishing a new Android version.

## CI credentials

GitHub Actions uses three encrypted repository secrets:

- `ATHENA_ANDROID_KEYSTORE_BASE64`: the existing Android signing keystore.
- `ATHENA_ANDROID_STORE_PASSWORD`: its password (also used for the `athena` key).
- `ATHENA_ANDROID_GOOGLE_SERVICES`: Firebase Android client configuration for
  `com.athena.android`.

The workflow materializes private build inputs under a temporary runner path and
an ignored configuration file, removes them on exit, and uploads only the APK,
checksums and public build metadata. Docker contexts exclude the Android tree, local runtime data and signing/Firebase input files. The Firebase service-account credential that
sends notifications belongs only on the server; it must never be supplied to an
APK build or included in its artifacts.

Release secrets are available only in the signing step. Version tags are checked
against reviewed main history before that step. This workflow does not configure
repository rulesets or change who may push tags; repository administration remains
separate. Anyone authorized to modify Actions workflows must remain trusted with
repository Actions secrets.

## Local verification

From `apps/android`, run unit tests and lint before building. Release signing uses
`ATHENA_ANDROID_KEYSTORE`, `ATHENA_ANDROID_STORE_PASSWORD`, optional
`ATHENA_ANDROID_KEY_ALIAS`, and optional `ATHENA_ANDROID_KEY_PASSWORD`. Set
`ATHENA_ANDROID_BUILD_REVISION` to the source commit when producing release
metadata. Firebase client configuration belongs in the ignored
`app/google-services.json` file.

`node scripts/android-release.mjs manifest <apk> <output-json>` checks the APK
identity and certificate using Android build-tools 35.0.0. Run the real-WebView
instrumentation test with `:app:connectedDebugAndroidTest` on an emulator.
Upgrade verification must preserve the installed signing identity and compare
saved app/web data before and after installation; a clean installation alone does
not demonstrate an upgrade.
