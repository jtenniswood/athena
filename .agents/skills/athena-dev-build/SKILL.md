---
name: athena-dev-build
description: Dispatch and monitor Athena's ad hoc development image workflow when asked to build a dev image.
---

# Athena development image build

Use this skill when the user asks to build and publish an Athena development
image. It dispatches the existing GitHub Actions workflow; it does not deploy
the image.

## Choose the source revision

- Build the branch or ref the user names. If they do not name one, use the
  current branch only when it is clearly the intended target; otherwise ask
  which branch to build.
- Builds use the revision pushed to GitHub. Never commit or push as part of this
  skill. If the user expects local uncommitted changes to be included, explain
  that they must first be committed and pushed.
- Confirm the selected branch exists on `origin` and that the dev workflow is
  available in the repository's default branch. If either check fails, stop and
  report what is missing.

## Dispatch and monitor

The repository is `jtenniswood/athena`; the workflow is
`.github/workflows/dev-image.yml`. A direct request to run the build authorizes
dispatching this workflow and publishing its image to GHCR. Do not dispatch for
questions about the workflow or hypothetical build requests.

Use GitHub CLI to dispatch the workflow for the selected branch:

```sh
gh workflow run dev-image.yml --repo jtenniswood/athena --ref BRANCH
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

Each successful ad hoc run updates `dev-latest`. The workflow does not deploy,
and does not change the release-only `latest` tag.
