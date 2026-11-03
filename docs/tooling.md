# Development tooling

Use this index to choose a development or diagnostic command. Current browser
ownership is described in [browser architecture](browser-architecture.md).
[Releases and rollback](releases.md) owns publication, deployment and recovery.
Historical plans do not add acceptance gates to ordinary changes.

## Active development and hosting

| Tool | Entry point / caller | Purpose |
| --- | --- | --- |
| Pinned renderer | `pnpm prepare:renderer`, `pnpm check:renderer`; Docker and compatibility workflow | Fetch and verify the exact renderer in `flake.lock`; refuse modified or mismatched sources. |
| Dependency baseline | `pnpm check:renderer-dependencies`, `pnpm report:renderer-dependencies`; browser build, Docker and compatibility workflow | Check renderer-sensitive versions and show other manifest differences. |
| Typecheck and build | `pnpm typecheck`, `pnpm build`; Docker and compatibility workflow | Validate the wrapper and its renderer integration and build the browser app. |
| Development server | `pnpm dev`; manual local invocation | Serve the app with the same-origin gateway proxy. |
| Compatibility registry | `pnpm check:compatibility-registry`, `pnpm docs:compatibility`; Vite plugins and compatibility workflow | Check reviewed source/output fingerprints and generate the inventory and TypeScript aliases. Generation does not accept new fingerprints. |
| Behavioral verification | `pnpm verify:behavior`; compatibility workflow and focused local checks | Plan declared scenarios for selected entries or changed wrapper dependencies, then verify actual Node/Chromium execution results. |
| Hosting configuration | `scripts/runtime-config.mjs`; Docker entrypoint and Vite | Validate hosting settings and generate runtime scripts and nginx configuration. |
| Runtime services | `apps/web-desktop/server/services.mjs`; Vite, preview and `scripts/serve.mjs` | Assemble shared preferences, Android sign-in and push services with one HTTP/WebSocket lifecycle. |
| Build identity | `scripts/build-info.mjs`; Vite | Record wrapper revision, renderer revision and dependency lock identity. |
| Versioned and manual image builds | `.github/workflows/release.yml`; version tag or manual dispatch | Publish the image; only a dispatch on `main` requests Komodo deployment. |
| Development images | `.github/workflows/dev-image.yml`; manual branch dispatch | Publish `dev-latest` and `dev-sha-<revision>` for testing, without deployment. |

The local loop is:

```sh
pnpm prepare:renderer
pnpm install --frozen-lockfile
pnpm check:renderer-dependencies
pnpm dev
```

Run typecheck/build for application changes and try the affected workflow. Use
existing focused tests for draft durability, selection races, authentication or
update activation when relevant. `pnpm test:foundation` is an optional collection
of Node checks, not a requirement to run every suite for every edit.

## Focused compatibility verification

The registry records which behaviors protect each adapter. List its checks before
running them:

```sh
pnpm verify:behavior --entry bot-session-cancellation --list
pnpm verify:behavior --changed origin/main --runner node --list
```

`--changed` compares the current tracked tree with a commit, including individual
registry edits and removed entries. It follows wrapper imports, injected wrapper
paths, and replacement-module dependencies conservatively. An owner containing
several handlers can select extra scenarios. Renderer, dependency-lock and shared
build-adapter changes select all entries. This is a verification plan, not proof
that tests ran or a measured coverage report.

Add `--run` to execute the selected scenarios. The runner matches literal declared
scenario text and verifies test names, files and successful execution results.
Skipped, missing or unmatched scenarios fail verification. An explicit
`--runner node` or `--runner browser` reports other references as deferred; it does
not claim to verify them. Upstream Vitest references remain supporting source
references and cannot satisfy this runner's execution check.

```sh
pnpm verify:behavior --entry browser-settings-pending-saves --runner node --run
HERMES_TEST_IMAGE=athena:local pnpm verify:behavior --entry bot-session-cancellation --runner browser --run
```

Browser scenarios retain their existing fixture requirements: interruption tests
need a built nginx image and Docker; previous-image upgrade tests also need their
immutable baseline. `--output test-results/behavior.json` saves the plan or actual
execution results for inspection.
Browser screenshots and traces use an isolated temporary directory recorded in
the execution report, so another Playwright invocation cannot delete them.

Settings presentation changes have focused Node checks in
`scripts/settings-presentation.test.mjs` and
`scripts/config-field-presentation.test.mjs`. The browser fixtures
`tests/browser/native-settings.spec.mjs` and
`tests/browser/settings-presentation.spec.mjs` verify explicit commands, stale
profile/owner rejection, imports, secret omission, payload limits, React Strict
Mode and pending-save failures. They do not require a Docker image. The built
application's Android web-layout and configuration tests additionally exercise
the real renderer, wrapper pages, profile-scoped saves and draft preservation.

The compatibility workflow runs affected declared Node scenarios and uses the
selection-race entry for a focused built-image check when relevant engine or
selection boundaries change. It preserves the plans and execution results as
optional diagnostic artifacts. It does not run the entire browser suite or
change the deployment process.

## Optional diagnostics and parked automation

| Tool | Caller / invocation | Status |
| --- | --- | --- |
| Synthetic gateway and browser fixtures | `scripts/preview/`, `tests/browser/`, `compose.browser-preview.yml` | Optional isolated workflow checks; see [browser preview](browser-preview.md). |
| Previous-image upgrade baseline | `scripts/prepare-upgrade-baseline.mjs`, `tests/fixtures/upgrade-baseline.json` | Optional real-composer upgrade/rollback diagnosis. |
| Compatibility report | `pnpm check:upstream`, `scripts/renderer-compatibility-report.mjs` | Useful when reviewing a renderer pin change. |
| Renderer proposal tooling | `renderer-update.yml`, `scripts/propose-renderer-update.mjs`, update-state and policy helpers | Retained automation; keep activation parked unless explicitly requested. |
| Automation setup audit | `pnpm check:update-setup` | Read-only check of the optional updater setup; missing parked setup does not block development. |
| Repository rules configurator | `scripts/configure-repository.mjs` | Retained for the old automation design. Its apply mode changes repository settings; it is not routine setup. |

The retained updater is described in [upstream updates](upstream-updates.md).
It does not replace the active image publisher or the externally maintained
Komodo deployment configuration.

## Historical executables and plans

| Retained asset | Current use |
| --- | --- |
| `scripts/legacy/promote-image.mjs`, `scripts/legacy/record-candidate.mjs` | Old staged-image promotion/evidence design. No current workflow calls them. |
| `scripts/legacy/release-evidence.test.mjs` | Optional checks for that historical publisher: `node --test scripts/legacy/*.test.mjs`. |
| `pnpm legacy:stage-static-artifact` | Stage a downloaded static UI artifact with the retained web helper; it does not deploy the current Docker/Komodo stack. |
| `deploy/production/` | Earlier SSH/Compose deployment assets; they do not describe the active external Komodo stack. |
| Reset, evolution, migration, startup, mobile and settings execution plans in `docs/` | Historical design and delivery records. Their old status and checklists are not current acceptance requirements. |
| `docs/release-evidence/` | Historical candidate evidence; not required for normal image builds. |

Do not use a moving image tag to identify a rollback target. Build publication,
deployment-request acceptance and deployment completion are distinct events;
follow [releases and rollback](releases.md) to verify the running revision and
recover with the prior immutable image while preserving storage and volumes.
