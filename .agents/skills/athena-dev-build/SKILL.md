---
name: athena-dev-build
description: Dispatch and monitor Athena's ad hoc development image workflow when asked to build a dev image.
---

# Athena development image build

Use this skill when the user asks to build and publish an Athena development
UI image. It dispatches the existing GitHub Actions workflow. A successful main
build automatically triggers the separate Komodo deployment-request workflow;
state this effect before dispatch and honor existing session authorization.

## Choose the source revision

- For a normal UI development build, always build `main`, even when the user invokes the skill from another
  branch or names a different ref. Dispatch with `--ref main`; GitHub builds
  the code already merged and pushed to `main`. The local checkout and its
  working tree do not affect the build, so do not switch branches or alter
  local changes.
- Never commit or push as part of this skill. If the user expects local
  uncommitted changes to be included, explain that they must first be committed,
  pushed, and merged to `main`.
- Confirm `main` exists on `origin` and that the dev workflow is available in
  the repository's default branch. If either check fails, stop and report what
  is missing.

## Dispatch and monitor

The repository is `jtenniswood/athena`; the workflow is
`.github/workflows/dev-image.yml`. A direct request to run the build authorizes
dispatching this workflow and publishing its image to GHCR. Do not dispatch for
questions about the workflow or hypothetical build requests.

Use GitHub CLI to dispatch the workflow for `main`:

```sh
gh workflow run dev-image.yml --repo jtenniswood/athena --ref main
```

Before dispatch, record the IDs of recent `workflow_dispatch` runs for this
workflow and branch. After dispatch, poll `gh run list` until a new run ID
appears for that branch, then watch that exact run with `gh run watch RUN_ID
--repo jtenniswood/athena --exit-status`. If no new run appears within two
minutes, report that the dispatch was accepted but the run could not be located;
do not dispatch a second time automatically. If GitHub CLI reports a permission
or dispatch error, stop and report it without retrying.

Report the run URL, built commit, and result. On success, give the user these
image references:

- Moving ad hoc tag: `ghcr.io/jtenniswood/athena:dev-latest`
- Commit-specific tag: `ghcr.io/jtenniswood/athena:dev-sha-COMMIT`

Main builds publish the UI and `ghcr.io/jtenniswood/athena-hermes` companion by default. Each image gets its own development tags. A successful main run triggers the signed Athena Komodo deployment request; a feature-branch run publishes without that request. Stable `latest` tags are unchanged.

## Prepare a requested Hermes server change before UI merge

The main-only rule above applies to normal UI builds. When a user requests a
companion-server image change needed before a UI migration can merge, publish
only that companion from its committed, pushed feature branch:

```sh
gh workflow run dev-image.yml --repo jtenniswood/athena --ref FEATURE_BRANCH -f image=hermes
```

This exception publishes `ghcr.io/jtenniswood/athena-hermes:dev-latest` and
`dev-sha-COMMIT`, and leaves the UI image unchanged. Use the same exact-run
identification and monitoring procedure. Verify that the UI publish step was
skipped. Pull and exercise the immutable server tag before sharing the matching
Compose file. Keep the existing Hermes data volume and authentication settings.
Do not use this exception to publish the UI from an unmerged branch.
