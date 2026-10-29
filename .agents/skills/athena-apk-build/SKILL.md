---
name: athena-apk-build
description: Build and download a signed Athena Android APK from the latest main on demand. Use for latest APK requests, not Docker images or versioned Android releases.
---

# Build the latest Athena APK

Generate an installable, Firebase-configured APK with the existing Android signing
key using GitHub Actions in `jtenniswood/athena`. The workflow is
`.github/workflows/android-apk.yml` and its artifact is `android-signed-apk`.
A request to generate an APK authorizes dispatching this workflow and downloading
its build artifacts. Creating this skill or asking how it works does not authorize
a build.

## Source and preflight

- Build `main` at dispatch time with `--ref main`. Local changes and unmerged PRs
  are not included. Leave the checkout and working tree alone; do not commit,
  push, merge or create version tags as part of this skill.
- Confirm `main` exists on `origin` and the workflow is available on the default
  branch. If either is missing, report the blocker. Do not substitute a debug APK:
  it cannot update the signed app and may lack Firebase configuration.
- This workflow uses the existing repository signing and Firebase secrets and
  verifies the pinned signing certificate. Never request, download or print those
  secrets, change the signing key, or bypass verification after a failure.

## Dispatch and monitor

Record recent run IDs before dispatch:

```sh
gh run list --repo jtenniswood/athena --workflow android-apk.yml --branch main --event workflow_dispatch --limit 20 --json databaseId,headSha,status,conclusion,url
```

Dispatch once:

```sh
gh workflow run android-apk.yml --repo jtenniswood/athena --ref main
```

Poll the same run list until a new run appears, then watch that exact ID:

```sh
gh run watch RUN_ID --repo jtenniswood/athena --exit-status
```

If no new run appears within two minutes, report that dispatch was accepted but
its run could not be located. Do not automatically dispatch again. Stop on a
permission error or failed/cancelled/skipped build, report the run URL and useful
failure details, and do not label an older APK as the new result.

## Download and verify

After success, create a fresh temporary output directory (or use the user's
requested destination), then download:

```sh
gh run download RUN_ID --repo jtenniswood/athena --name android-signed-apk --dir OUTPUT_DIR
```

The directory must contain `athena-android-latest.apk`, `build-info.json` and
`SHA256SUMS`. Check both files against `SHA256SUMS` with `shasum -a 256 -c
SHA256SUMS` from that directory (or `sha256sum -c` on Linux). Confirm the metadata
revision equals the watched run's `headSha`, its package is `com.athena.android`,
`firebaseConfigured` is true, and its certificate matches
`apps/android/release-signing.sha256` from that exact commit on GitHub. Do not
assume the local checkout contains the same fingerprint. Treat a mismatch as a
failed verification and do not offer the APK as ready to install.

Return a clickable absolute path to the APK, the run URL, source commit, app
version and version code. Include the run's artifact download link when available
(use `gh api repos/jtenniswood/athena/actions/runs/RUN_ID/artifacts` to obtain its
artifact ID; the browser link is
`https://github.com/jtenniswood/athena/actions/runs/RUN_ID/artifacts/ARTIFACT_ID`).
Artifacts expire after 30 days and may require GitHub sign-in.

Explain that it installs over an existing Athena app signed with the same key,
preserving its data. The workflow keeps `main`'s version code; if the installed
app has a higher code, report that a version bump must be merged first. Never
suggest uninstalling or clearing storage to force an update. The workflow creates
no version tag or GitHub release and does not build or deploy a server image.
See `docs/android/releases.md` for the versioned release process.
