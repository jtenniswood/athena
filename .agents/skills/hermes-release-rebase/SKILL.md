---
name: hermes-release-rebase
description: Update Athena's upstream baseline to the latest official stable Hermes Agent release, preserve its custom UI and external gateway, repair integration changes, and prepare a tested pull request. Use for requests to rebase Athena onto a released Hermes version or update its release baseline; version lookups alone do not run an update.
---

# Hermes Release Rebase

Advance Athena's pinned upstream baseline while preserving its browser UI and
existing gateway design. Deliver a reviewable PR with the selected release,
compatibility repairs and actual validation results.

## Establish the candidate

Read [AGENTS.md](../../../AGENTS.md) and the
[upstream update guide](../../../docs/upstream-updates.md). Inspect the working
tree, current pin and open update PRs; preserve unrelated work. Use an isolated
checkout when the candidate needs its own prepared renderer sources.

Resolve the latest published **stable release** from `NousResearch/hermes-agent`
at execution time through GitHub. Use the user's requested released version
when supplied. Exclude drafts and prereleases by default. Read the release notes
and compare changes since Athena's current pin. Verify the release tag's peeled
commit rather than following upstream `main`, a moving image tag or tag-name
sorting. If Athena already uses that release and needs no repairs, report it
without creating an empty update PR.

## Update the release baseline

- Prefer `pnpm update:hermes [vX.Y.Z]` to resolve and update the stable release,
  including the immutable `testGatewayImage`. Run `pnpm sync:renderer-dependencies`
  after preparing the new sources.
- Update `flake.lock`'s Hermes `rev`, `narHash` and `lastModified` for the verified
  commit, and update `hermes-release.json`'s version and revision together. Obtain
  lock metadata with Nix locking/fetch tooling or an equivalent verified fetch;
  never guess a hash or reuse metadata from another commit. Preserve the original
  flake input and unrelated lock entries. Follow the repository's Nix build rule.
- Prepare with `pnpm prepare:renderer` and install with
  `pnpm sync:renderer-dependencies`, then `pnpm install --no-frozen-lockfile` when
  updating the dependency lock; verify a frozen install afterward. Existing fetched trees belonging to the old
  revision cause preparation to refuse: prepare the candidate in a fresh
  checkout rather than modifying upstream files or overwriting the old checkout.
- Run `pnpm check:upstream` and `pnpm report:renderer-dependencies`. Inspect changes
  to the affected contracts and dependency manifests. Repair Athena-owned
  adapters, transforms and overrides; regenerate compatibility outputs when
  needed. Refresh fingerprints only after reviewing the changed behavior.
  Keep dependency and lockfile updates limited to the release's requirements.

## Preserve the remote gateway architecture

Athena's production image serves its UI and proxies the existing Hermes server
selected by `HERMES_GATEWAY_URL` in Compose. Keep authentication, profiles, agent
execution and Hermes data on that server. Preserve drafts, recording lifetimes,
profile/session ownership, preference sync and safe UI updates.

Review protocol changes against the remote bridge and identify any backend
version requirements. Use the separate disposable server in
`.github/workflows/remote-gateway.yml` for integration verification. If its pinned
fixture image needs updating, resolve an immutable official release image and
verify its installation commit matches the selected release. Keep this image a
test fixture. Report the server version actually tested; updating Athena does
not upgrade or reconfigure the operator's existing Hermes server.

## Verify and deliver

Run `pnpm check:official-release`, `pnpm check:renderer`,
`pnpm check:renderer-dependencies`, `pnpm check:compatibility-registry`,
`pnpm typecheck` and `pnpm build`. Use focused regression checks for integration
breaks; the foundation suite is useful when changes span several adapters.
Exercise the affected real-gateway workflows, especially chat, draft reload,
profile ownership and sign-in/sign-out when their contracts change. Real image
builds run in GitHub Actions. Distinguish completed checks from pending or
unavailable checks and diagnose failures before declaring success.

Use normal commits on a `codex/*` branch and push after meaningful commits.
Open or update the PR on `origin`, keeping unrelated changes out. Describe the
previous and target release/commit, repairs, tested backend version, validation
and remaining compatibility limitations. Follow existing session authorization
for any subsequent merge or deployment.

The moving-main scheduled updater has been removed. Use the manual release
command and normal PR flow. Keep future recurring proposals disabled unless
explicitly requested; do not change repository settings.

The native bridge requires the existing gateway's enabled Webapp listener,
normally port 9120. Preserve the previous backend origin in
`HERMES_GATEWAY_IDENTITY_URL` when changing listeners, and keep the browser
connection owner `web-single` so drafts and profile routes retain their scope.
Merging to `main` builds the development image and automatically requests a
Komodo deployment; report required external configuration changes before merging.
