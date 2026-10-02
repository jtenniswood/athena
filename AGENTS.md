# AGENTS.md — for AI coding agents working in Athena

This file is addressed to AI coding agents (e.g. the Hermes agent). It is NOT
user-facing documentation; keep user-facing content in `README.md`.

## Project

Athena — the **Hermes Agent chat UI** as a web app / PWA
(`apps/web-desktop`). An **unofficial community wrapper** of
`NousResearch/hermes-agent` (not affiliated). The renderer sources
(`apps/desktop`, `apps/shared`) are **not in this repo** — they are fetched from
the pinned `hermes-agent` at build time.

## Non‑negotiable rules

- **English only** — every comment, doc, description and commit message in English.
- **Never edit `apps/desktop/` or `apps/shared/`** — they are upstream renderer
  sources fetched at build time (read‑only in the nix store). Change rendering
  only through our files: `apps/web-desktop/src/`, `src/web-bridge/`,
  `src/overrides/`, `vite.config.ts`, `web.css`.
- **Never force‑push / rewrite history.** `origin` is the GitHub repository for
  this project. Keep `main` and feature branches on that repository, and open
  all pull requests there.
- **Never commit secrets or VPS‑identifying data.** `.env` is gitignored and
  stays local; `.env.example` holds placeholders only; `PLAN.md` is gitignored
  (internal); do not add LAN IPs, tailnet hostnames or `/home/ubuntu` paths to
  tracked files.
- **The VPS never builds nix locally** (house rule) — real builds run on GitHub
  Actions (`release.yml`). `nix eval` / `nix flake
  show` locally is fine.

## Remotes & push discipline

- `origin` — GitHub (`https://github.com/jtenniswood/athena.git`) — **primary** and the target for all pull requests.
- The upstream of `main` is `origin/main`.

For every user request that changes tracked repository content—including code,
documentation, configuration, and generated files—finish by opening a pull
request on `origin` once the change is reviewable. Do not treat the request as
complete after only editing the working tree. Commit the requested changes, push
the feature branch, and create the PR. Keep unrelated existing work out of the
PR. Do not merge or deploy unless explicitly requested.

Before editing, inspect the working tree and preserve pre-existing changes.
Stage and commit only the requested work. Give each PR a clear title, a short
summary of the change, and the verification performed. If a push or PR creation
is blocked by GitHub availability or permissions, leave the work ready for
review and report the specific blocker; do not claim the task is complete.

After every meaningful commit, push the branch:
```bash
git push origin <branch>
```

## Build & dev

- **Docker (primary image, NIX-FREE):** `docker build -t athena .` fetches
  the exact renderer revision in `flake.lock`, typechecks, and builds the UI.
- **Dev loop:** `pnpm prepare:renderer` → `pnpm install --frozen-lockfile` →
  `pnpm dev` (port 5174). `nix develop` is an optional development environment;
  do not run Nix builds on the VPS.
- **Verify:** For application changes, run `pnpm typecheck` and `pnpm build`
  when practical, then exercise the affected workflow. For documentation or
  low-risk changes, use checks appropriate to the change. Report checks that
  could not be completed.

## Development scope

This is a personal project in early development. Prefer small, reversible changes
and a short feedback loop. Do not require a full test suite, staged image
promotion, release evidence records, or physical-device acceptance for routine
changes. Existing tests are optional tools; use targeted checks for meaningful
risks such as draft loss, conversation-selection races, authentication, and PWA
activation. Do not add tests that merely mirror a styling or low-impact change.

Keep the current framework and upstream chat engine. Add small adapters when a
feature needs them, consolidate repeated browser interactions incrementally, and
avoid speculative architecture or a second mutable conversation store. Preserve
draft, recording, selection, and safe-update behavior while simplifying code.

`docs/releases.md` describes the current build/deploy/rollback process. Earlier
reset/evolution plans and renderer automation checklists are historical, not
additional acceptance gates. Keep automated renderer activation parked unless
explicitly requested. Do not alter repository settings as part of routine work.

## Fixing problems

Diagnose the reported symptom, make the smallest useful fix, and check the
affected workflow. Images build in GitHub Actions; a push to `main` publishes
and deploys the image with container-health rollback. Keep feature work on a
branch and open a PR on `origin`. Do not merge or deploy unless requested.

Use the previous immutable image digest for rollback if a deployed change breaks
behavior. Keep browser storage, runtime configuration, and data volumes intact.
