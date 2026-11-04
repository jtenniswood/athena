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
  adapters.
- `apps/web-desktop/build/renderer/` owns build-only transforms, replacements,
  branding and the compatibility registry. Runtime modules do not import it.
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

The core product shell consumes `experience/contracts/engine.ts` through
`BrowserEngineProvider`. `upstream/engine-host.tsx` implements that interface
with the pinned renderer's existing owners. Conversation actions, profiles,
navigation, project drops, approval mode and reusable engine surfaces cross this
boundary as plain projections, commands or React surfaces. Settings controllers
remain lazy so opening chat does not eagerly load the settings implementation.
The provider carries the host implementation; it does not cache or copy engine
state. Specialized feature adapters and visual primitives retain their separate
boundaries.

The pinned renderer also supplies a complete browser-host installer, but it
assumes injected Hermes bootstrap data, the `local` connection identity and its
server's UI-preference store. Athena retains its own authentication, `web-single`
identity and persisted preference owners. Reuse compatible public helpers through
small adapters instead of replacing that startup contract wholesale. External-link
and preview commands use the shared `externalUrlTarget` policy; only its web
subset reaches the browser opener. The link menu uses the same command.

`experience/settings/settings-route.tsx` assembles settings navigation from the
catalog. The checked settings controller adapter extracts the existing Hermes
page controls and commands without generating the browser frame. Schemas, values,
profile-scoped requests, caches, and pending saves retain their renderer owners.
Unknown renderer pages remain available in Other Settings. The fullscreen and
embedded frame variants share compact navigation and focus behavior; each keeps
its appropriate overlay host and breakpoint. Legacy bookmarks and field links
are normalized by the browser route policy without dropping other query values.

`experience/contracts/settings-presentation.ts` defines the shared Settings row
model. Mounted owners publish committed labels, values, availability and commands
through `experience/settings/presentation.tsx`. Chat panel preferences, themes,
configuration actions and choices, sync status, notification permission, profile
tabs, plugin navigation and update controls use their original callbacks for both
web controls and explicit presentation descriptors. The frame publishes its own
navigation, search, close/back commands and active configuration scope.

The config-field adapter also projects the renderer's resolved schema metadata
and original commit callbacks for booleans, numbers, text, lists, JSON and closed
or searchable choices. Two checked transforms publish the metadata and attach a
ref to existing row elements; they add no wrapper elements or alternate config
store. Structured editors, open-ended suggestion fields and extension actions
retain their existing renderer presentation.

Android continues to use web Settings. The retained optional native presenter
consumes the same descriptors when explicitly installed by a compatible client
or test fixture. Its DOM compatibility path remains for renderer controls that
do not publish descriptors. Explicit commands have opaque owner identities,
reject removed/disabled fields and stale profile scopes, and preserve the
original file-import and pending-save owners. Unsupported or oversized snapshots
leave the complete web editor available. This interface does not reactivate
native Settings or native menus in the current application entry point.

`experience/session-row.tsx` owns session-row geometry, density, primary actions,
keyboard access and drag handles. `upstream/session-row.tsx` projects live engine
metadata, status and extension decorations and retains the engine's mutation and
menu commands. A guarded module replacement connects every list surface to this
row; source rewrites for row gestures, title previews and reorder handling are
removed. Row actions and their portalled dialogs cannot resume the conversation.
`experience/sidebar.tsx`, `sidebar-section.tsx` and `sidebar-project.tsx` own the
navigation frame, section disclosure and project overview presentation. Typed
adapters in `upstream/sidebar.tsx` and `sidebar-project.tsx` project the existing
renderer controller values into those views. Search, filtering, profile scope,
pagination, lazy project hydration and saved ordering keep their original owners.
The controller projection replaces a named function's return and removes only
explicitly identified view bindings; nested callbacks and hooks remain intact.
Source fingerprints and the compiler validate this boundary on renderer updates.

`experience/sidebar-profile.tsx`, `sidebar-tree.tsx` and `sidebar-cron.tsx` own
profile headers, tree nesting, repository/worktree lanes, paging affordances and
scheduled-job rows. The profile and workspace adapters project live owners and
captured commands. Hermes retains group aliases/order, branch switching, lazy
lanes, removal confirmations, cron trigger concurrency and live-run polling.
Profile lists preserve configured pictures, hidden-group preferences and complete
histories; no parallel profile or project cache is introduced.
Project and workspace chat creation commands publish navigation intent directly.
Compact navigation does not infer those commands from document clicks or CSS classes.
Browser startup deliberately keeps project navigation at the overview. The
reusable worktree views preserve the renderer's controller boundary without
enabling drill-in or changing that navigation policy.

The old search-layout, section-markup, profile-avatar, project-disclosure and
desktop-navigation rewrites are removed. Generic engine primitives such as
virtualization, sortable lists, context menus and extension contributions remain
reusable surfaces. Product-specific sidebar views no longer depend on rewriting
their upstream HTML layout.

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

Shift+Enter is handled by that mounted composer's keyboard command after its IME
guards. The native line-break command uses the existing undo checkpoint and
immediate draft flush, rather than running ahead of the owner in a global listener.

Timeline scrubbing is mounted on the renderer's virtual rail through a checked
adapter. The browser hook maps pointer coordinates, UI scale and scroll offset
to the rail's existing entries, then calls its original jump command. Pointer
capture belongs to the mounted rail; gestures cannot cross into another rail or
continue after its conversation owner changes. The owner is the existing timeline
index key, including its connection/profile/session scope; refreshing entries
within that owner does not interrupt a drag. Keyboard and ordinary click navigation,
virtualization, history loading and jump cancellation remain renderer-owned.

Submit scrolling is mounted inside the renderer's transcript list. It consumes
the existing scroll/content refs, composer surface ID and session/profile/visibility
lifetime. Accepted sends address only that mounted surface, after checking the
original draft owner or the send's explicit fresh-session assignment. Hidden sends
and late acceptance for another draft do not reposition the visible transcript.
The transient command registry stores callbacks, not conversation data. Reservations
and pending animation frames are released on selection, profile, visibility or
mount changes; content reconciliation remains observed inside that transcript.
No document search or window event chooses a transcript by display identity.

## Capability and lifecycle boundaries

Browser, hosting, and connected-server support facts are described in
`platform/capabilities.ts`. API availability does not imply permission; the
owning browser operation still handles permission and failure at use time.

`scripts/browser-preference-contract.mjs` records wrapper preference keys, owners,
scope, defaults, parsers, serialization, and legacy migrations. The browser's
typed access and subscription helper and the account-sync allowlist consume this
same contract. Existing keys and wire formats remain compatible. Same-tab writes
and relevant storage events share a subscription path with stable snapshots.
The zoom bridge projects the active desktop/mobile scale preference into CSS and
renderer change events. Same-tab and cross-tab writes use the shared preference
subscription, while pointer/viewport changes select the existing mode's value.
Bridge commands suppress their own storage notification to preserve shortcut
precision and one change event per action, including when optional saves fail.
Sidebar and session-profile migrations are repeatable and preserve migration
inputs until the replacement is verified. Optional preferences tolerate blocked
storage; connection credentials, drafts, and account-bound sync outboxes retain
their stronger persistence owners and checks.

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

## Runtime service ownership

`apps/web-desktop/server/` owns the running preference, Android authentication,
and notification services. `createAthenaServices` assembles the same route owners
for Vite development, Vite preview, and the container's Node server. Each host
attaches it once and closes it with its HTTP server. The gateway proxy and static
asset server remain hosting concerns.

The services share account identity derivation and non-redirecting Hermes session
probes. Each endpoint explicitly chooses its accepted credentials; browser
handoffs continue to transfer only approved Hermes cookies, and native token
refresh remains restricted to its installation binding. Existing account hashes,
preference files, push bindings, API routes, and the data volume stay compatible.

`apps/web-desktop/server/main.mjs` starts the production host. It uses the shared
runtime configuration generator from `scripts/`; development and preview continue
to assemble the same services without starting nginx.

## Compatibility ownership

`scripts/renderer-adapter.mjs` owns the ordered build adapters, module replacements,
virtual modules, and aliases used by Vite and TypeScript. The compiler checks the
adapted source graph, including injected imports and scoped replacements; it does
not validate a separate unmodified renderer graph. Original renderer input
fingerprints stay reviewed and fetched sources remain untouched. Adapter tests
check final output fingerprints, replacement resolution, and whether introduced
type errors and missing imports fail compilation.

`pnpm inspect:renderer` exports the same transform output for review, alongside
original modules, wrapper replacement sources and their importer policies. Its
manifest identifies the revisions, lockfile, registry, adapter inputs and emitted
bytes. These ignored snapshots make the integration inspectable without creating
another build graph or accepting changed fingerprints; see the tooling index.

Browser transforms are grouped by settings, composer, roster, navigation and
hosting in `build/renderer/transforms/`. `build/renderer/browser-plugin.ts` assembles their ordered
pipeline. The registry names the feature owner for each single-feature transform;
mixed pipelines retain their assembly owner. Build and adapter tests use the
same wrapper-only module loader. Moving a handler does not accept new renderer
input or output fingerprints.

`upstream/entry.ts` installs the bridge and restores its profile before loading
`upstream/engine-registration.ts`. That module contains the pinned renderer's
controller registration dependency. Browser initialization follows registration;
the desktop controller itself remains absent from the rendered shell.

### Renderer embedding boundary

The browser-facing `BrowserEngine` interface is an Athena contract. Its current
implementation still obtains core initialization by importing the renderer's
desktop controller. The plugin SDK's `host.state` projections provide access to
existing engine state; they do not replace the controller's registration work.

| Initialization responsibility | Current renderer owner | Behavior to preserve |
| --- | --- | --- |
| Core panes, status items and commands | `app/contrib/controller.tsx` | Contributions exist before the browser shell consumes them; mount `ContribWiring` once |
| Default layouts and contributed panes | `app/contrib/layout-presets.ts` and the controller | Retain saved layout compatibility while browser policy suppresses desktop session tile mirrors |
| Bundled and runtime plugins | `contrib/plugins.ts` and `contrib/runtime-loader.ts` | Core registers before bundled plugins; install discovery watchers once and retain existing enable/disable owners |
| Pin synchronization, unread acknowledgements and dead-session pruning | `store/session-pin-sync.ts`, `store/session-unread-remote.ts`, `store/dead-session-prune.ts` | Preserve connection scope and authoritative stores; avoid duplicate subscriptions or pruning passes |

An upstream embedding entry point could replace this dependency when it owns
those registrations explicitly, supports the browser's single-conversation
capabilities, and keeps settings controllers available without extracting them
from view implementations. Bridge installation, authentication, preference
loading and profile restoration must still precede stores that read them.

Lifecycle ownership also needs an explicit contract. Pin and unread watcher
setup currently returns no disposer, while dead-session pruning returns an
unsubscribe callback. Wrapping the controller import in a differently named
function would not make those lifetimes independent or safely repeatable.

Retain the checked registration adapter until such an upstream contract is
available. Migrate one responsibility at a time through the existing renderer
update process, preserving plugin ordering, draft durability and selection
behavior before removing the corresponding compatibility seam. This map does
not change the existing development or release process.

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
`build/renderer/compatibility-registry.json` with its owner, reviewed source and output
fingerprints, behavioral verification references, and removal condition. The
generated [browser transform inventory](browser-transform-inventory.md) is the
human-readable index. Add or change an adapter only in wrapper-owned code, and
refresh a fingerprint only after reviewing the corresponding renderer change
and its behavior.

Remove a compatibility seam when the pinned renderer provides an equivalent
public contract and the affected browser behavior is verified. Keep seams that
still protect drafts, selection, or browser-specific interaction even when
their transform has been stable for a long time.
