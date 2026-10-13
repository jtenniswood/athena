# Releases and rollback

Hermes Web is a personal project in early development. The normal loop is:
make a small change, typecheck and build, try the affected workflow, then merge.
A full browser suite, staged image promotion, and release evidence records are
not required for routine changes.

The [tooling index](tooling.md) separates active commands, optional diagnostics,
parked automation and historical executables. The old staged publisher and its
evidence recorder are retained under `scripts/legacy/`; no current workflow calls
them. `pnpm legacy:stage-static-artifact` names the earlier static-artifact helper
explicitly and does not deploy the current Docker/Komodo stack.

## Build and deploy

`.github/workflows/release.yml` runs for version tags and manual dispatches. It
builds and publishes a native `linux/amd64` image after checking the pinned
renderer, typechecking, and building the frontend. Every run publishes `latest`
and `sha-<revision>`; version tags also publish their version tag. The renderer
revision comes from `flake.lock`.

A manual dispatch on `main` also sends a signed deploy request to the configured
Komodo stack listener. A manual dispatch on another branch and a version-tag run
only build and publish. Merges to `main` do not trigger this workflow. GitHub
Actions records whether the listener accepted the request; acceptance does not
prove that the stack finished deploying or that the application workflow works.

The deployment stack configuration is maintained outside this repository. Its
image reference, health checks, deployment completion, and rollback behavior
must be verified in Komodo. Do not assume that the retained
`deploy/production/compose.yml` scripts describe the active deployment.
After deployment, confirm the running image revision and exercise the changed
workflow. Use the stack's configured recovery procedure if its health check fails.

### Versioned image release

Use the `athena-release` project skill with a stable `MAJOR.MINOR.PATCH`
version, such as `1.4.0`. It creates and pushes the annotated Git tag
`v1.4.0` from the current, clean `main` commit. That tag starts the release
workflow and publishes `ghcr.io/jtenniswood/athena:1.4.0`, along with the
`latest` and `sha-<commit>` tags. The version tag is written without the `v`
prefix in the image registry.

The skill requires `main` to match `origin/main` and refuses an existing
version tag. Version-tag builds publish the image but do not request a production
deployment.

### Ad hoc development image

To build a test image without moving a release tag or deploying it, open
**Actions → Build development image → Run workflow** and select the branch to
build. The workflow publishes `ghcr.io/jtenniswood/athena:dev-latest` and the
immutable `dev-sha-<revision>` tag. Each completed run updates `dev-latest`;
version releases alone update `latest`.

On the host, pull the latest ad hoc build with:

```sh
docker pull ghcr.io/jtenniswood/athena:dev-latest
```

Configure your test system to use `ghcr.io/jtenniswood/athena:dev-latest` as its
image reference. The development workflow only builds and publishes the image;
it does not trigger a deployment. For a private GHCR package, sign in on the
host before pulling.

## Deployment setup

The release workflow expects these repository Actions values for its signed,
Cloudflare Access protected Komodo request:

- Variable `KOMODO_WEBHOOK_URL`, using the Komodo stack deploy listener route.
- Secrets `KOMODO_WEBHOOK_SECRET`, `CF_ACCESS_CLIENT_ID`, and
  `CF_ACCESS_CLIENT_SECRET`.

The workflow checks that these values are present and that the listener URL is
HTTPS with the expected route shape. The actual Komodo stack definition and its
runtime configuration are outside this repository. Verify the configured stack
uses the intended Athena image and preserves the existing Hermes data mount,
gateway settings, published port, and reverse-proxy connection before changing
deployment configuration.

The older SSH/Compose assets remain in `deploy/production/`. Their presence
does not mean the current GitHub workflow uses them. Confirm the active Komodo
stack's deployment and recovery procedure before relying on those scripts.

## Roll back

For a functional regression, identify the last known-good immutable image from
the Actions build output or GHCR (`sha-<revision>` or its digest). Use the
recovery procedure configured for the active Komodo stack to redeploy that
image. Do not use the moving `latest` tag to identify a rollback target. The
exact stack edit and rollback command cannot be documented here because the
active Komodo stack definition is not tracked in this repository.

Keep the existing runtime configuration and data volumes during recovery. Do
not clear browser storage or rebuild an old commit to recover a previous
release. Installed PWAs still coordinate activation with open tabs so drafts
and active work remain protected.

## Focused checks when useful

Use existing checks for the behavior being changed, rather than running every
suite for every edit. For example, draft persistence changes can use:

```sh
node --test scripts/draft-persistence.test.mjs
```

For changes to PWA activation or rollback, the existing real-composer upgrade
suite is available on demand with a built candidate image:

```sh
node scripts/prepare-upgrade-baseline.mjs
HERMES_TEST_IMAGE=hermes-web:verification pnpm exec playwright test tests/browser/upgrades.spec.mjs --project=chromium
```

This suite uses a synthetic gateway and an immutable previous image from
`tests/fixtures/upgrade-baseline.json`. It is optional diagnostic coverage, not a
release gate. Keep its baseline distinct from the candidate when using it.

## Renderer updates

Keep renderer upgrades separate from unrelated UI changes when practical. Review
changed compatibility assumptions, typecheck and build, then try the affected
chat workflows. Keep source fingerprints and draft/update protections intact.

Automatic renderer proposals are parked. They are not required to develop,
publish, or deploy this app. The [updater reference](upstream-updates.md) describes
the retained automation tooling; its historical activation checklist is not the
current development policy. Neither `HERMES_RENDERER_UPDATES_ENABLED` nor
`HERMES_PROMOTION_ENABLED` controls the normal image publisher or deployment.
