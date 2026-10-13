# Historical image publication tooling

These scripts belong to the earlier staged-image promotion and release-evidence
design. No current GitHub workflow invokes them. The active publisher is
`.github/workflows/release.yml`; development images use `dev-image.yml`.

The scripts and their focused tests are retained for reference. Run their tests
explicitly with `node --test scripts/legacy/*.test.mjs` if changing them. They are
not release gates and do not describe the active Komodo deployment stack.

See [the tooling index](../../docs/tooling.md) and
[releases and rollback](../../docs/releases.md) for current commands.
