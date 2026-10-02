---
name: hermes-renderer-update
description: Prepare a reviewable Athena update to an official Hermes Agent release, repair wrapper integration breaks, and verify the result. Use when the user explicitly asks to run or prepare a Hermes renderer update; not for version questions alone.
---

# Hermes Renderer Update

Prepare a tested, reviewable update of Athena's pinned Hermes renderer. The normal result is a feature branch and pull request; do not merge or deploy it.

## Workflow

1. Read the repository `AGENTS.md` and `docs/upstream-updates.md`. Inspect the current branch and working tree first. Preserve unrelated edits; use an isolated worktree or clean clone when the active checkout is dirty.
2. Resolve the latest **official release** from `NousResearch/hermes-agent` (or use the exact release/revision requested by the user). Pin its exact commit in `flake.lock`; do not float the input to `main` or change the `flake.nix` input. Verify the tag points to that commit.
3. Prepare both renderer source trees at the pinned revision with `pnpm prepare:renderer`, then install dependencies with `pnpm install --frozen-lockfile`. Never edit `apps/desktop/` or `apps/shared/`; they are fetched upstream sources.
4. Run `pnpm check:upstream` and inspect the upstream diff and each changed or missing compatibility contract. Repair only Athena-owned code under `apps/web-desktop/`, its adapter/configuration files, and generated compatibility outputs. Update dependencies only when the renderer requires them. Do not accept fingerprints or diagnostic baselines without reviewing the changed behavior.
5. Add focused regression coverage for confirmed integration breaks. Run `pnpm typecheck`, `pnpm test:foundation`, `pnpm build`, `pnpm check:renderer`, and `pnpm check:compatibility-registry`; run relevant browser checks when available. Report any unavailable Docker-image or real-gateway checks accurately.
6. Keep the change on a `codex/*` branch, commit only this update, push to `origin`, and open or update its PR. Include the release/tag/commit and actual verification results. Never merge, deploy, change repository settings, or enable recurring updates as part of this skill.

## GitHub Actions dispatch

The repository's `renderer-update.yml` supports a manual dispatch from `main` with an optional exact 40-character `renderer_revision`. Read the workflow and runbook before using it. A passing candidate can receive protected auto-merge, and a merge to `main` publishes an image. Therefore, a request to prepare an update or to create a PR does not by itself authorize dispatching that workflow. If the user specifically requests dispatch, explain that merge/publication path and get explicit authorization for those effects before triggering it. Do not change `HERMES_RENDERER_UPDATES_ENABLED` or `HERMES_PROMOTION_ENABLED`.

If the workflow reports incompatibilities, use its artifacts as evidence and repair them through a manual-review PR. Do not change fingerprints just to make the automated run pass. Follow `docs/upstream-updates.md` for exact dispatch commands, proposal handling, retry policy, and rollback details.
