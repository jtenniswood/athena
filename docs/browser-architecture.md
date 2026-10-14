# Browser architecture

Athena is a browser shell around the pinned Hermes renderer. The shell keeps
browser behavior and product composition in wrapper-owned code while the
renderer remains responsible for conversation state and upstream features.

## Ownership

- `apps/web-desktop/src/experience/` owns navigation, layout, wrapper actions,
  settings presentation, and the composition of renderer contributions.
- `apps/web-desktop/src/platform/` owns browser APIs, browser persistence,
  connection state, and safe lifecycle transitions such as update and sign-out.
- `apps/web-desktop/src/upstream/` owns the adapter boundary to the fetched
  renderer: its browser root, desktop-shaped bridge, route and workspace
  adapters, and reviewed transforms.
- `apps/web-desktop/src/overrides/` replaces a narrow renderer surface when the
  browser needs a different interaction, such as gateway settings.
- `apps/web-desktop/src/pwa/` owns service-worker registration and the
  cross-tab update handshake.

Renderer modules are loaded only after startup installs the bridge and runs
browser initialization. Browser pane ownership follows one wrapper policy,
used by the host's panel commands and workspace surface. The adapter projects the existing
renderer layout without changing its saved state.

`upstream/entry.ts` starts the browser host after authentication and profile
migration. `upstream/browser-host.tsx` mounts the engine's contribution wiring
and exposes browser surfaces and plain panel commands. The shell does not consume
renderer contribution objects or the engine's menu components. Conversation,
selection, profile and action adapters project the authoritative stores; they do
not create a second conversation store. `upstream/browser-api.tsx` remains the
explicit visual primitive boundary.

The chat action menu and its keyboard shortcuts use the same browser commands.
Rename and delete dialogs retain the conversation they were opened for even if
selection changes before a request completes. Sidebar row menus still use a
guarded renderer adapter for project and appearance actions.

Hidden canonical Bot chats may be absent from sidebar session slices. Their
identity projection also reads the exact current engine workspace owner and
requires its canonical session ID to match the selected chat. It never falls
back to the last selected Bot, and it does not insert hidden chats into the
sidebar or create another conversation store.

Follow-up policy is resolved inside the renderer's existing composer submit
command. The browser preference chooses Queue or Steer; Cmd/Ctrl+Enter requests
the alternate action while busy. Queue editing, IME handling, disabled controls,
attachment fallback and rejected-submit restoration remain engine-owned. No
document listener finds or clicks composer buttons to apply this preference.

## Capability and lifecycle boundaries

Browser, hosting, and connected-server support facts are described in
`platform/capabilities.ts`. API availability does not imply permission; the
owning browser operation still handles permission and failure at use time.

The renderer registers its draft store through `platform/draft-safety.ts`.
Update and connection transitions use that typed boundary to flush cross-tab
writes and verify persisted text before they proceed. Ordinary draft saves keep
their synchronous behavior.

Settings edits register an explicit save callback with
`platform/settings-save.ts` when the edit is made. Ordinary saves remain
debounced; transition preparation starts the latest callback immediately and
waits for the renderer's serialized write queue and gateway confirmation. Closing
the settings route retains its pending callback. Active-profile changes cancel
unsent edits and drain requests already in flight; a completed request from the
old profile cannot seed the new profile's configuration cache. Failed writes
continue to block readiness instead of being treated as durable.

## Compatibility ownership

`scripts/renderer-adapter.mjs` owns the ordered build adapters, module replacements,
virtual modules, and aliases used by Vite and TypeScript. The compiler checks the
adapted source graph, including injected imports and scoped replacements; it does
not validate a separate unmodified renderer graph. Original renderer input
fingerprints stay reviewed and fetched sources remain untouched. Adapter tests
check final output fingerprints, replacement resolution, and whether introduced
type errors and missing imports fail compilation.

`upstream/entry.ts` installs the bridge and restores its profile before loading
`upstream/engine-registration.ts`. That module contains the pinned renderer's
controller registration dependency. Browser initialization follows registration;
the desktop controller itself remains absent from the rendered shell.

Renderer-sensitive dependency versions are checked by
`pnpm check:renderer-dependencies`. They inherit the fetched renderer's manifest;
`scripts/renderer-dependencies.json` records deliberate version overrides and the
upstream version each override was reviewed against. A changed upstream version
requires another review. `pnpm report:renderer-dependencies` prints sensitive
versions and other manifest differences without accepting changes. Keep the
actual versions in the application manifest and lockfile; run typecheck, build,
and focused workflow checks when changing the baseline. Renovate groups these
libraries for review. Security fixes can still be reviewed separately with an
explicit override and the same checks.

`package.json` owns the pnpm version used by Docker and GitHub Actions.

Every renderer replacement or transform is recorded in
`upstream/compatibility-registry.json` with its owner, reviewed source and output
fingerprints, behavioral verification references, and removal condition. The
generated [browser transform inventory](browser-transform-inventory.md) is the
human-readable index. Add or change an adapter only in wrapper-owned code, and
refresh a fingerprint only after reviewing the corresponding renderer change
and its behavior.

Remove a compatibility seam when the pinned renderer provides an equivalent
public contract and the affected browser behavior is verified. Keep seams that
still protect drafts, selection, or browser-specific interaction even when
their transform has been stable for a long time.
