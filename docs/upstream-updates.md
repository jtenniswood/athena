# Update the Hermes release baseline

Athena builds its presentation layer against an exact official Hermes release.
`hermes-release.json` records the tag, peeled commit and immutable **test-only**
gateway image. `flake.lock` records the same source commit and its Nix fetch hash.
The production Athena image contains the UI and hosting services; the operator's
Hermes server remains separate.

## Prepare an update

Use the [hermes-release-rebase skill](../.agents/skills/hermes-release-rebase/SKILL.md)
for the full repair, verification and PR workflow. The manual command resolves a
published stable release, peels annotated tags, obtains verified Nix metadata,
and updates the source pins and separate test fixture together:

```sh
pnpm update:hermes --check
pnpm update:hermes
# Or select a specific published stable release:
pnpm update:hermes v0.23.0
```

The command needs GitHub CLI authentication, network access and Nix metadata
support. Nix runs only a metadata fetch, never a local image build. If Nix is not
installed locally, run its metadata tooling in a disposable container or use a
GitHub Actions development environment. Do not guess or reuse fetch hashes.

Start from a clean `codex/hermes-release-*` branch based on current `origin/main`.
Resolve the candidate in a fresh checkout: renderer preparation refuses to
replace older or modified source paths. The update command does not merge,
upgrade a running Hermes server, change repository settings or deploy anything.
If the selected stable release is already pinned, it makes no changes.

```sh
pnpm prepare:renderer
pnpm sync:renderer-dependencies
pnpm install --no-frozen-lockfile
pnpm check:official-release
pnpm check:renderer-dependencies
pnpm check:upstream
pnpm typecheck
pnpm build
```

Dependency synchronization inherits the upstream manifest and locked Shiki
family. Explicit exceptions remain in `scripts/renderer-dependencies.json` and
must be reviewed when the release changes their upstream versions. Independent
Renovate updates for those renderer packages are disabled; Athena-only tooling
can still update normally. Never remove an exception until its regression check
passes with the official version. The assistant-ui snapshot fixes remain because
the official v0.23.0 baseline reproduces an infinite render loop in Athena.

Athena inherits the official Vite configuration's pure build, CSS and dependency
optimization options. Its own plugins retain browser hosting, UI adapters, assets
and PWA behavior. Fetched sources stay untouched. Upstream's internal composition
interfaces can change; this is a smaller integration surface, not a stable public
renderer SDK.

Athena retains small host adapters for its stable owner identity, guarded file
picker and uploads, sign-in recovery, clipboard selection fallback, notifications,
app windows and mounted UI plugin files. The official bridge owns server file
access and Webapp transport, including one-use socket tickets.

## Review and repair

Review the upstream compare link printed by the update command. Inspect changes
to the registered modules, browser bridge, profiles, composer and dependencies.
The source-contract report locates changed integration points; a changed hash is
not itself proof of broken behavior. Fix owned adapters, inspect transformed
output, and update fingerprints only after reviewing their new behavior. Keep
all production guards and meaningful behavior checks.

Run the affected workflows, including real sign-in, chat, draft reload, file
staging, sign-out and profile ownership. The separate fixture in
`.github/workflows/remote-gateway.yml` enables the official Webapp listener and
checks its installation stamp against the release commit. Real Athena image
builds run in GitHub Actions.

Commit and push meaningful changes, then open a PR on `origin`. Include the old
and new releases, retained exceptions, tested gateway version, repair summary,
checks and any operator configuration changes. A passing source preflight alone
is insufficient evidence for merging an update.

## Deployment boundary

Use the existing server's Webapp listener, normally port 9120, as Athena's target.
Keep `webapp.public_url` set to Athena's browser-facing URL. When changing the
listener address, retain the prior origin in `HERMES_GATEWAY_IDENTITY_URL` to
preserve browser and account namespaces. See [gateway configuration](../wiki/Gateway-Configuration.md).

The moving-main scheduled updater and its automatic merge machinery have been
removed. Updates use the manual command and normal PR review. Existing GitHub
App credentials and repository variables are unnecessary for this path; no
repository settings are changed by this migration.

Merging to `main` builds `dev-latest`; a successful build automatically triggers
the existing Komodo update request. Coordinate required Hermes/Compose changes
before merging. A successful webhook is acceptance of the request, not proof of
completed deployment. See [releases and rollback](releases.md).
