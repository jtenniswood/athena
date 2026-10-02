# Optional renderer-update tooling

Automatic renderer proposals are parked during personal development. No GitHub
App, automation enablement checklist, or release evidence package is needed for
ordinary changes. See [releases and rollback](releases.md) for the active workflow.

## Manual renderer changes

`flake.lock` pins the exact `NousResearch/hermes-agent` revision supplying both
`apps/desktop` and `apps/shared`. Keep upgrades separate from unrelated UI work
where practical. Updating the lock metadata with `nix flake update hermes` does
not build Nix locally.

### Update and repair loop

Check for upstream changes after each tagged Hermes release, or monthly if
there has been no release. The normal update target is upstream `main`; use an
exact earlier revision only when a specific fix is needed without taking newer
changes, and record the reason in the pull request. Treat each renderer change
as a candidate until the browser build and affected workflows pass.

1. Start a `codex/renderer-update-*` branch from current `main`. Keep the first
   commit limited to the `hermes` pin in `flake.lock` so the compatibility report
   shows the impact of the upstream change on its own.
2. Run the preparation and checks below. Review the upstream compare link for
   changes to renderer entry points, bridges, settings, session selection,
   composer behavior, and dependencies. Use the compatibility report to locate
   changed or missing source contracts.
3. Fix each failure in Athena-owned code. Keep upstream files read-only. For a
   changed upstream contract, update the owning adapter or transform and its
   focused checks. If an upstream behavior was removed or redesigned, adapt the
   browser integration to the new contract rather than weakening the guard or
   copying the old upstream implementation into Athena.
4. Rerun the failed check after each repair, then rerun the full preparation,
   compatibility, typecheck, and build sequence. Try the affected browser flows
   in the built app. At minimum, cover the workflow named by each changed
   contract; also check sending a message and switching conversations when
   renderer selection or composer contracts changed.
5. Review the final diff for accidental source changes, unreviewed fingerprint
   refreshes, and unrelated work. Include the starting and resulting renderer
   revisions, failures found, repairs made, checks run, and any known limitation
   in the PR. Merge only after the repair commit and all required checks pass.

If an update has a broad or unclear failure, keep the candidate PR open and
revert only the renderer pin while diagnosing in a separate repair branch. Do
not merge a pin that needs an unreviewed adapter change. Once repaired, bring
the repair into the candidate and repeat the checks above. If the update cannot
be made compatible, close the candidate with the failing contract and evidence;
the current pin remains the working version until a later candidate resolves it.

After changing the pin, prepare the renderer and inspect compatibility:

```sh
pnpm prepare:renderer
pnpm install --frozen-lockfile
pnpm check:upstream
pnpm typecheck
pnpm build
```

Renderer preparation refuses to overwrite mismatched or modified source paths.
Resolve that mismatch before proceeding; never edit fetched renderer files.
Review changed contracts in `apps/web-desktop/src/upstream/compatibility-registry.json`.
Do not blindly refresh fingerprints to make an upgrade pass. Adjust wrapper-owned
adapters only where the reviewed upstream change requires it, then manually try
the affected chat workflows. Use an existing focused test if it helps diagnose a
selection, storage, or connection regression.

## Retained automation

The optional `renderer-update.yml` workflow and updater scripts remain available.
When configured, the workflow can propose an exact renderer pin every six hours,
after main changes, or on manual dispatch. It requires a repository-scoped GitHub
App and repository checks expected by the updater. Those checks are not currently
provided by the quick image publishing workflow; inspect the configuration before
choosing to restore automatic updates.

`node scripts/check-update-setup.mjs` audits the retained automation setup. Missing
App credentials or disabled switches are expected while it is parked and do not
block ordinary development. Do not apply `configure-repository.mjs` as routine
project setup; it changes repository rules for the older automation design.

The updater restricts proposals to renderer lock metadata and refreshes branches
with merge commits. It cannot repair adapters or bypass repository protection.
`HERMES_RENDERER_UPDATES_ENABLED` controls recurring proposals. The updater also
checks `HERMES_PROMOTION_ENABLED` as a readiness flag; neither variable disables
normal publication or deployment after a push to `main`.

To stop recurring proposals if they were previously enabled:

```sh
gh variable set HERMES_RENDERER_UPDATES_ENABLED --body false
```

An existing proposal may still have auto-merge enabled and needs separate
attention. Changing this variable does not roll back a deployed image.
