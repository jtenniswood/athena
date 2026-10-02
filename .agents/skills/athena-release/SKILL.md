---
name: athena-release
description: Create a versioned Athena Docker image release by tagging a clean, current main commit and starting its GitHub Actions build. Use when the user requests a specific release version.
---

# Athena Release

Create a stable, versioned Docker image release for the Athena repository. A release tag starts the existing `.github/workflows/release.yml` workflow; it builds and publishes the versioned image to GHCR.

## Release procedure

1. Get a stable `MAJOR.MINOR.PATCH` version from the user if one was not supplied. Accept the version without a leading `v`, for example `1.4.0`. Do not choose or increment a version on the user's behalf.
2. Confirm the checkout is the Athena repository and `origin` points to `https://github.com/jtenniswood/athena.git` (SSH form is also acceptable). If not, stop and report the repository mismatch.
3. Fetch `origin/main` and tags. Release only from a clean `main` checkout whose `HEAD` is exactly `origin/main`. If there are tracked or untracked changes, the current branch is not `main`, or `main` is behind/ahead of `origin/main`, stop and explain what needs to be resolved. Never include unmerged feature work in a release.
4. Validate the version as three non-negative integer components with no leading zeroes except `0`. Do not accept a `v` prefix, prerelease suffix, build metadata, or other tag format. Check that neither the local nor remote `vVERSION` tag already exists. Never move or overwrite an existing tag.
5. Before publishing, state the target commit, Git tag (`vVERSION`), and image tag (`ghcr.io/jtenniswood/athena:VERSION`). The user's explicit request to release that version authorizes creating and pushing this tag; do not ask for a second confirmation.
6. Create an annotated tag named `vVERSION` at the verified `HEAD`, with message `Athena VERSION`, then push only that tag to `origin`. Do not push a branch or rewrite a tag as part of this skill.
7. Follow the Actions run triggered by the tag when GitHub access is available. Confirm it completed successfully and that its build output contains the expected version tag and image digest. If the run fails or cannot be observed, report the Actions run link or the relevant blocker. Do not push the same tag again, retag, or start a replacement run without an explicit user request.

The workflow also updates `latest` and `sha-COMMIT` for a successful version-tag build. Version-tag builds do not trigger the production deployment job; that job runs only for pushes to `main`. Do not create a GitHub Release entry or deploy production unless the user separately requests it.
