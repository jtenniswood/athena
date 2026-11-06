# Releases and rollback

Athena is a personal project in early development. The normal loop is:
make a small change, typecheck and build, try the affected workflow, then merge.
A full browser suite, staged image promotion, and release evidence records are
not required for routine changes.

The [tooling index](tooling.md) separates active commands, optional diagnostics,
release update tooling and historical executables. The old staged publisher and its
evidence recorder are retained under `scripts/legacy/`; no current workflow calls
them. `pnpm legacy:stage-static-artifact` names the earlier static-artifact helper
explicitly and does not deploy the current Docker/Komodo stack.

## Build and deploy

`.github/workflows/release.yml` runs for version tags and manual dispatches. It
builds and publishes a native `linux/amd64` image after checking the pinned
renderer, typechecking, and building the frontend. Stable main and version-tag
builds publish `latest` and `sha-<revision>`; version tags also publish their
version tag. Manual feature branch builds publish `dev-latest` and
`dev-sha-<revision>` instead. The renderer
revision comes from `flake.lock`.

Athena's image serves the UI and proxies the existing Hermes server configured
by `HERMES_GATEWAY_URL` in Compose. It does not bundle or supervise Hermes.
The renderer remains pinned to the official release in `hermes-release.json`.
The remote-gateway integration check builds Athena and exercises it against a
separate disposable Hermes server; that server is only a CI fixture.

A manual dispatch on `main` also sends a signed deploy request to the configured
Komodo stack listener. A manual dispatch on another branch and a version-tag run
only build and publish. Separately, every push to `main` builds a development
image, and `.github/workflows/komodo-update.yml` requests deployment after that
build succeeds. Merging a PR therefore also requests a Komodo deployment. GitHub
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

### Automatic and ad hoc development images

Every push to `main` runs **Build development image** and publishes
`ghcr.io/jtenniswood/athena:dev-latest` and `dev-sha-<revision>`. The same push
also runs **Build latest Android APK**, producing the signed development APK
`athena-android-latest.apk` in the `android-signed-apk` Actions artifact and an
`android-main-<commit>` prerelease. See [Android APK releases](android/releases.md)
for downloads and the opt-in latest-main update channel. Each commit has its own
concurrency group so another push cannot replace its pending build.

To build a development image without moving a stable release tag, open
**Actions → Build development image → Run workflow** and select the branch to
build. The workflow publishes `ghcr.io/jtenniswood/athena:dev-latest` and the
immutable `dev-sha-<revision>` tag. Each completed run updates `dev-latest`;
only stable main and version-tag publication updates `latest`. Both publishers
use `scripts/image-publication.mjs` to select tags, release identity, and deployment
eligibility. Stable version tags use `vMAJOR.MINOR.PATCH`; malformed or prerelease
tags cannot update the stable channel.

On the host, pull the latest ad hoc build with:

```sh
docker pull ghcr.io/jtenniswood/athena:dev-latest
```

Configure your test system to use `ghcr.io/jtenniswood/athena:dev-latest` as its
image reference. A successful main-branch development build triggers the separate Komodo update
workflow. A feature-branch development build publishes without that automatic
deployment request. For a private GHCR package, sign in on the
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
uses the intended Athena image and preserves the existing preference volume,
Webapp target, stable gateway identity, published port, and reverse-proxy
connection before changing deployment configuration. Hermes data stays on the
separate server.

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
If that historical image is unavailable, build the exact previous commit with
its `HERMES_WRAPPER_REV` build argument, then set `HERMES_UPGRADE_BASELINE_FILE`
to a JSON file with `image` (an immutable `sha256:` image ID or registry digest),
`platform`, `wrapperRevision`, `rendererRevision`, and `verificationRun` fields.
The fixture verifies the running image's exact revisions before testing updates.
Report the chosen baseline and any unavailable historical-image check.

## Renderer updates

Keep renderer upgrades separate from unrelated UI changes when practical. Review
changed compatibility assumptions, typecheck and build, then try the affected
chat workflows. Keep source fingerprints and draft/update protections intact.

Automatic renderer proposals have been removed. Use the manual stable-release
command and PR workflow in the [updater reference](upstream-updates.md). Neither
`HERMES_RENDERER_UPDATES_ENABLED` nor `HERMES_PROMOTION_ENABLED` controls the normal
image publisher or deployment.

## Native Webapp connection migration

Athena's v0.23.0 renderer integration uses Hermes's official browser services.
Enable `webapp` on the existing Hermes server and point `HERMES_GATEWAY_URL` at
its listener, normally port 9120. Set `webapp.public_url` to Athena's public URL.
Keep `4174:80`, the Cloudflare host-port target and the preference volume.

Retain the previous gateway origin in `HERMES_GATEWAY_IDENTITY_URL` when changing
listeners; it preserves storage identity without routing requests to that old
address. Apply these external settings before the Athena image update. A rollback
may also require restoring the previous target; keep the data volumes, identity
setting and browser storage intact. The earlier combined image's Python setup
service and `/opt/data` mount are unnecessary for the UI-only image.


## Companion Hermes server image

`Dockerfile.hermes` layers the Compose-driven Webapp startup hook onto the
immutable official `gatewayImage` in `hermes-release.json`. It inherits the
existing gateway runtime and adds no package installation or renderer build.
The development and stable publishers build `ghcr.io/jtenniswood/athena-hermes`
with the same channel/tag policy as the UI package. The images remain separate.

For a listener migration, prepare the companion from the PR branch before the
UI merge using **Build development image**, selecting `hermes` for its image
input. That build publishes only the server package and does not trigger the
main-only Komodo request. Use its immutable `dev-sha-<revision>` tag on the
existing Hermes service and apply the [Compose settings](../wiki/Gateway-Configuration.md#configure-webapp-through-the-server-image).
Keep its data volume and credentials, then verify the listener before merging
the UI change. Every successful main run still requests the existing Athena
Komodo deployment, including a manually selected server-only main run.
