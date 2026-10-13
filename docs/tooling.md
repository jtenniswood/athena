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
| Hosting configuration | `scripts/runtime-config.mjs`; Docker entrypoint and Vite | Validate hosting settings and generate runtime scripts and nginx configuration. |
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
