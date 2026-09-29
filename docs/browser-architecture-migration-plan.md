# Browser architecture migration plan

Status: initial adapter, save-readiness, and settings-frame deliveries
implemented; later deliveries remain planned. Prepared: 2026-09-29.

## 1. Outcome and scope

Hermes Web should own the browser experience while continuing to use the pinned
Hermes renderer, chat engine, and authoritative stores. Browser features should
depend on small adapters that expose product concepts and commands. Desktop
implementation details should stay inside those adapters and the compatibility
layer.

The intended result is easier maintenance and safer upstream upgrades with the
same conversation behavior, saved preferences, authentication, and protection
for unfinished work. A smaller transform count is useful only when it reflects
less coupling without moving the same complexity into copied upstream code.

This plan develops five recommendations from the expert-reset review:

1. Make the renderer boundary an explicit product interface.
2. Give browser components ownership of workspace composition incrementally.
3. Finish the shared interaction layer and replace structural DOM inference.
4. Separate settings presentation policy from configuration ownership.
5. Include pending settings and other mutations in application-lifetime safety.

Keep React, Vite, the current directory structure, and the upstream chat engine.
Do not introduce another conversation store, copy the renderer, replace the
settings backend, or build a general-purpose application framework.

This document remains the staged execution roadmap. The initial implementation
tranche covers adapter boundaries and pending settings-save readiness. Later
deliveries remain separate, reviewable work; renderer upgrades, repository
settings, merging, deployment, and parked update automation remain outside this
scope unless separately requested.

### Execution progress: 2026-09-29

- Delivery A added focused project-action, approval/profile, and remote-folder
  adapters. The adapter suite found direct renderer imports in the remote folder
  picker; those imports now pass through `upstream/`, and all 16 adapter checks
  pass.
- Delivery B confirmed that the pinned settings form uses a 550ms debounced
  queue and cancels its timer on unmount. A checked compatibility transform now
  keeps the latest queued save alive across page exit and records save failures
  for update readiness. The source lifecycle is covered, but a deterministic
  delayed/rejected gateway fixture and live category/profile navigation checks
  remain outstanding.
- Delivery C adds an in-memory pending-work registry and includes it in the
  update readiness handshake. The worker keeps normal network admission open
  while settings saves and drafts flush, then pauses and rechecks readiness
  before activation. The worker protocol and conversation/configuration stores
  remain unchanged.
- Delivery D adds a browser-owned full-viewport settings frame around the
  renderer-owned navigation and content. Wide screens use a persistent category
  rail; narrow and short-landscape screens use a category list and detail view.
  Resizing and returning to the list keep the active settings page mounted. A
  browser regression now checks viewport coverage, navigation, close behavior,
  and conversation draft retention.
- Validation passed: `pnpm typecheck`, `pnpm build`,
  `pnpm check:compatibility-registry`, `pnpm check:upstream`,
  `node scripts/adapter.test.mjs`, four pending-work tests, and the focused draft
  and update-coordinator tests. The new browser regression was not executed: a
  live preview server could not bind its loopback port in this environment.
- The next delivery is E, declarative settings presentation policy, followed by
  selected interaction seams and any workspace composition experiment justified
  by those results.

## 2. Relationship to existing guidance

Use [AGENTS.md](../AGENTS.md) and [releases and rollback](releases.md) for the
development and delivery process. Keep routine work small: typecheck, build,
and manually exercise the affected workflow. Use existing targeted tests where
state loss, selection races, authentication, or update activation justify them.

The [settings experience plan](settings-experience-execution-plan.md) contains
the detailed settings interaction requirements. This plan adds its dependency
on pending-save ownership and places that work in the broader migration.
Reconcile overlapping tasks before implementation; do not implement the same
settings adapter twice.

The [UI styling guide](ui-styles.md) remains the source for tokens, density,
breakpoints, and shared component choices. Earlier
[reset](browser-reset-execution-plan.md) and
[evolution](browser-evolution-execution.md) documents are historical context.
Their old release gates and completed tasks do not become new requirements.

The [preview guide](browser-preview.md) describes useful local fixtures and the
isolated Compose stack. Verify its CI instructions against the actual workflows
before using them: the checkout inspected for this plan has `release.yml` and
`renderer-update.yml`, and no separate browser-preview workflow. This plan does
not require adding one.

## 3. Baseline and confidence

### Repository state

The review inspected wrapper commit
`9162ad9ae44d700f302b1e07701e523298b4feac` on `codex/command-approvals`, tracking
`origin/main`. The renderer pin was
`03b0c7947262b220f5148b75a30bb7a3faddcbb2`.

The worktree already contained changes in:

- `apps/web-desktop/src/experience/browser-shell.tsx`
- `apps/web-desktop/src/experience/sidebar-sections.tsx`
- `apps/web-desktop/src/upstream/browser-plugin.ts`
- `apps/web-desktop/src/upstream/compatibility-registry.json`
- `apps/web-desktop/src/web-overrides.css`
- The untracked `docs/settings-experience-execution-plan.md`

Those changes were preserved. Some findings concern unfinished local work;
recheck the eventual implementation base rather than treating this snapshot as
the final behavior of main. Do not commit unrelated local changes with this plan
or with a later migration PR.

### Evidence and implications

| Observation | Evidence | Planning implication |
| --- | --- | --- |
| Browser contracts and read-only projections already exist. | `experience/contracts/`, `upstream/conversation.ts`, `upstream/profiles.ts` | Extend the current approach rather than starting another state model. |
| The registry has 90 entries: 10 renderer transforms, 39 browser transforms, and other integration entries. | `upstream/compatibility-registry.json` | Reduce particular dependencies; do not set a numerical transform-removal target. |
| Four experience imports resolve directly to renderer modules. | `browser-shell.tsx` imports projects and notifications; `settings-menu.tsx` imports profile and gateway-request modules. | Move them through explicit adapters. Shell imports include pre-existing local work. |
| Browser workspace rendering projects the desktop pane tree and removes restored session tiles. | `upstream/browser-workspace.tsx`, `upstream/workspace-tree.ts` | Test a panel boundary before replacing workspace composition broadly. |
| Route contexts retain the conversation while tools cover it. | `upstream/browser-routes.tsx`, `experience/tool-modal.tsx` | Preserve one live conversation/composer instance during all presentation changes. |
| Some behavior depends on utility classes or icon/element structure. | `experience/navigation.tsx`, `web-overrides.css` | Replace fragile hooks at the affected interaction boundary. |
| Settings autosave has a 550ms debounce and serialized requests. | Read-only upstream `app/settings/config-settings.tsx` | Audit pending edits, profile changes, and unmounting before changing the frame. |
| Reload readiness inspects responses, file operations, media, and composer drafts. | `platform/reload-safety.ts` | Determine how configuration saves should participate; no data-loss bug was demonstrated. |
| Updates freeze interaction, pause network activity, flush drafts, and verify all tabs before activation. | `pwa/register.ts`, `pwa/update-network.ts`, `public/update-coordinator-sw.js` | Preserve this protocol while extending per-tab readiness. |

All abbreviated source paths above are under `apps/web-desktop/src/` unless
explicitly marked upstream. `apps/desktop/` and `apps/shared/` are read-only
references and must never be edited.

### Checks already performed

During the preceding review:

- `pnpm check:renderer` passed and matched the pin above.
- `pnpm check:compatibility-registry` passed with 90 declared integration entries.
- `pnpm check:upstream` passed: 73 fingerprint contracts checked, none requiring
  review, and no dependency contracts pending installation.
- Five focused test files passed: conversation model, selection owner, draft
  persistence, state safety, and update coordinator.
- A selected adapter-boundary test invocation failed with only a file-level
  failure. Its exact cause remains unresolved. A separate TypeScript import
  inspection confirmed the four direct renderer imports; that inspection does
  not establish why the test process failed.

The preflight validates declared contracts, not executed browser behavior. No
full typecheck, frontend build, live-browser journey, or real-gateway validation
was performed for the architectural review. Do not present earlier screenshots
as proof of current behavior.

## 4. Product behavior to preserve

### Conversation and selection

- One visible conversation remains the browser model. Do not restore desktop
  session tabs, split chats, or duplicate title bars.
- Sessions, canonical Bot conversations, and groups retain their actual engine
  ownership. A stale asynchronous open must not replace a newer selection.
- Row commands carry the relevant session, profile, and connection identity.
  Capture a command's owner when invoked; do not resolve it later from whichever
  profile happens to be active when a request completes.
- Background metadata hydration must not close navigation or change the
  visible conversation identity unexpectedly.
- Preserve streaming, cancellation, tool output, approvals, unread state,
  session mutations, and contributed tool behavior.

### Mounted content and navigation

- Opening settings or tools leaves the conversation and composer mounted.
- Closing a surface returns to the correct previous route, including query
  state, and restores focus to a useful control.
- Attachments, recording, queued-message editing, and text drafts retain their
  existing lifetimes. Presentation changes must not reset them.
- Resize changes presentation without remounting an editable form or composer
  solely because a breakpoint changed.
- Desktop keyboard menus, touch action sheets, compact navigation, and wide
  tablet touch density keep their distinct behavior.

### Data and deployment

- Keep current credentials, theme, zoom, draft keys, and browser preferences.
- A presentation rule that hides an option must not delete its configuration.
- The web server remains the owner of the single configured gateway target.
- Runtime configuration, authentication, API responses, and plugin files remain
  outside application precaching.
- Safe updates continue to defer for active or unsaved work and incompatible
  older tabs. Aborts must restore interaction and network operation.
- Rollback preserves browser storage, runtime configuration, and mounted data.

## 5. Target architecture

### Ownership boundaries

| Area | Owns | May depend on | Must not own |
| --- | --- | --- | --- |
| `experience/` | Navigation, browser surfaces, local interaction state, settings presentation policy | Browser contracts, explicit adapter exports, shared UI primitives, browser services | Raw renderer stores or duplicate chat/configuration persistence |
| `experience/contracts/` | Plain browser-facing types and pure derivation where useful | Plain TypeScript types and pure helpers | Renderer imports, browser globals, side effects, mutable stores |
| `upstream/` | Renderer imports, read-only projections, commands, content integration, checked compatibility hooks | Renderer/shared modules, browser contracts, narrow platform services | A second authoritative conversation/configuration store |
| `platform/` | Browser transport, authentication, files, clipboard, notifications, viewport, readiness coordination | Browser APIs and local contracts; existing type bridges during migration | Desktop pane placement or settings form logic |
| `pwa/` and worker scripts | Update discovery and all-tab activation | Per-tab readiness and the existing network barrier | Direct knowledge of individual settings fields or renderer stores |
| Build and hosting | Renderer pin, lockfile, aliases, runtime validation, build identity, image delivery | Existing scripts, Docker, optional Nix integration | Production chat state or duplicated runtime route definitions |

This is a tightening of existing boundaries, not a directory-wide reorganization.
Platform modules currently use some desktop-shaped types from `upstream/types.ts`.
Retain those bridges initially. Introduce neutral types only where the separation
removes a real dependency; do not perform a blanket type rename.

### Interface design rules

1. Expose the smallest interface needed by a browser feature. Prefer existing
   focused hooks and command functions over one large engine facade.
2. Project state from upstream; never continuously mirror it into another store.
3. Keep raw `$` stores and renderer request hooks inside `upstream/`.
4. Keep UI primitives separate from domain state/actions. Avoid expanding
   `browser-api.tsx` into an unrestricted renderer re-export barrel.
5. Commands retain error reporting, pending/confirmed reconciliation, and owner
   scope. Do not erase meaningful asynchronous results to simplify UI code.
6. A browser capability restricts presentation; it does not change backend
   permission or approval semantics.
7. Build-time replacements must retain importer scoping and bypass their own
   imports correctly. Test that wrappers cannot resolve recursively.

Examples of useful seams are project actions, active-profile approval controls,
contributed panel descriptions, and settings frame composition. Their exact
types should follow the pinned implementation, not speculative future needs.

### Authored and generated files

Browser components, contracts, policy, and adapter implementation remain
handwritten. The compatibility registry is authored and reviewed. Its inventory
and TypeScript alias outputs are generated through the existing tooling.

Never regenerate fingerprints merely to make changed input pass. Review source,
transform order, output, and affected behavior first. Generation of documentation
is not acceptance of an upstream contract. Keep `flake.lock` as the renderer
revision source; do not add a second renderer lock.

## 6. Delivery sequence

Use separate, reviewable PRs. Rebase or merge according to repository practice
without rewriting published history or force-pushing. Each feature branch uses
`codex/` and targets `origin`; do not merge or deploy unless requested.

The dependency order below is conceptual. Work on one shared-source delivery at
a time to keep the feedback loop short; it does not require parallel agents.

| Delivery | Outcome | Dependency | Effort | Useful stopping point |
| --- | --- | --- | --- | --- |
| A | Restore adapter boundaries and diagnose the existing check failure | Current baseline | Small | Browser features use explicit adapters with unchanged behavior. |
| B | Map and verify pending settings save lifetimes | Current baseline; A where needed | Small to medium | Evidence identifies safe behavior or a specific missing integration. |
| C | Extend readiness for a proven pending-work gap | B | Medium, conditional | Pending settings work safely delays updates without changing the worker protocol. |
| D | Responsive full-screen settings frame | A, B; C if required for safety | Medium | Settings layout improves while upstream forms and saves remain authoritative. |
| E | Declarative settings presentation policy | D | Medium | One policy controls supported IDs consistently and preserves values. |
| F | Replace a selected fragile interaction hook | A | Small per interaction | Explicit browser commands replace DOM inference. |
| G | Prove one contributed-panel composition boundary | A; stable affected interactions | Medium experiment | Decide whether broader composition ownership is practical. |
| H | Migrate additional proven workspace responsibilities | G shows a useful seam | Large overall, incremental PRs | Each migrated surface works; unsupported engine internals stay behind adapters. |
| I | Retire superseded transforms and reconcile documentation | After each replacement | Small per delivery | Removed coupling is documented and generated inventory is current. |

The initial useful milestone is A plus B. A successful reset does not require
completing H if it would duplicate the engine or introduce greater risk.

### Delivery A: restore adapter boundaries

1. Reinspect the implementation branch, renderer pin, local changes, and current
   import-boundary checker. Separate unfinished drag changes from baseline code.
2. Reproduce the adapter test failure with useful diagnostics. Determine whether
   it is an assertion, transform/typecheck failure, process setup problem, or
   another cause. Do not disable or weaken boundary checks to obtain a pass.
3. Add a narrow project adapter for eligible destinations and move commands.
   Preserve the existing project-root rule and session/profile command scope.
4. Let the adapter report failures through the existing error surface. Remove
   direct notification-module imports from browser composition.
5. Adapt approval/profile request handling so the settings menu consumes a
   browser-facing model or command instead of importing upstream request hooks
   and raw profile state. Keep profile-aware backend semantics and existing
   approval-mode behavior.
6. Extract drag interaction into a local hook/component only where it simplifies
   lifecycle handling. Keep draft, selection, and project actions with their
   current upstream owners.
7. Inspect the existing reorder work separately: an indicator is not evidence
   that reordering is committed or persisted. Preserve unfinished work rather
   than silently advertising it as complete.

Acceptance: `experience/` and affected overrides import no raw renderer modules;
the relevant boundary check has a known outcome; project and approval commands
retain scope, errors, and user-visible behavior. Manual project movement and
profile switching work without accidental conversation selection.

Rollback: revert the wrapper adapter/component changes. No storage migration,
renderer pin change, or backend data rewrite should be required.

### Delivery B: audit settings save ownership

Inspect the full settings entry point, configuration page, specialized pages,
profile scope, and search navigation. The inspected configuration page debounces
for 550ms, clears the timer during effect cleanup, and serializes requests.
Those facts justify investigation; they do not prove loss during every exit.

Build a small lifecycle map containing:

- Where an edit becomes pending, where a timer is scheduled, and when a save
  actually starts and becomes confirmed.
- Which category changes, route changes, Close actions, and profile changes
  unmount or rekey each relevant page.
- Which saves the network barrier sees and which edits have not yet become
  network requests when an update begins.
- How rejection is reported, whether failures remain detectable after an
  upstream catch, and what a successful flush would need to acknowledge.
- Which import/reset controls require a mounted input or browser user activation.

Use a deterministic delayed/rejected configuration-save fixture for the specific
behavior under investigation. Extend the synthetic gateway only for needed
operations; a generic success response cannot prove configuration persisted.

Exercise immediate Close before debounce expiry, category switching, profile A
to B switching, two sequential edits including a revert, update activation, and
a failed request. Record the value retained in the correct profile and whether
the form stayed mounted. Use test timing controls or observed requests rather
than relying only on fixed sleeps.

Acceptance: a documented owner/lifetime map and reproducible outcomes. If a
specific defect exists, fix the smallest supported integration before changing
mounting behavior. If no defect exists, preserve the verified mechanism and
avoid introducing unnecessary readiness abstractions.

### Delivery C: add pending-work readiness only where needed

If B identifies work missing from activation readiness, introduce a small
in-memory participant mechanism in `platform/`. Start by adapting existing
reload checks so behavior does not change. This registry tracks readiness
providers, not conversation or configuration values.

An illustrative interface, to finalize after the audit, is:

```ts
interface ReadinessResult {
  ready: boolean
  reason?: string
}

interface PendingWorkParticipant {
  id: string
  inspect(): ReadinessResult
  prepare?(): Promise<ReadinessResult>
}

// Returns an idempotent cleanup function.
declare function registerPendingWork(
  participant: PendingWorkParticipant,
): () => void
```

Registration belongs to the actual work owner. Unregistering a form cannot
make outstanding saves disappear; lifetime must cover those saves, or the exit
must wait while the owner remains mounted. IDs must distinguish concurrent
owners. Cleanup must work across unmount, hot reload, and aborted preparation.

Settings integration must retain the upstream queue, baseline, diff calculation,
cache publication, and profile identity. A supported `prepare` must flush the
latest pending edit through that owner and verify persistence, or return a
blocking reason. Do not replay saves through a second implementation, swallow
failures as readiness, or flush profile A's values into B. A timeout postpones
activation; it must not discard the edit or leave the UI locked.

Keep composer-specific draft snapshots, persisted-text verification, attachment
counts, and same-session cross-tab conflict detection. Generic participant
readiness supplements these checks; it does not replace them.

Before integrating a server save with the PWA handshake, inspect
`update-network.ts` to establish how it interacts with paused admission of new
requests. The current client pauses the network while preparing drafts. A flush
that needs a new request must not deadlock against that barrier or introduce an
unrestricted bypass. Prefer completing that save before the barrier when a
subsequent frozen-state verification can establish safety. If that ordering
cannot be proved safe, leave activation blocked while the save completes through
its normal path, then retry. Add narrowly scoped preparation admission only if
the simpler approach is insufficient and its races are explicitly tested.

Preserve the worker's prepare/verify/abort flow, transaction identity, client-set
checks, and treatment of older unresponsive tabs. Do not expand the wire protocol
unless unavoidable. A settings-aware new worker cannot retroactively make an
older client track settings work: document this first-release limitation. If
mixed-version safety requires a protocol/version change, design explicit
negotiation and conservative rejection in a separate focused PR.

Acceptance: activation waits for the audited work; rejected or timed-out saves
remain visible; work beginning during preparation invalidates readiness; aborts
restore interaction/network activity; existing draft, media, and multi-tab
protections still operate. Ordinary category navigation need not use the PWA
protocol; protect its pending edits through the settings owner.

### Delivery D: responsive settings frame

Follow the detailed [settings plan](settings-experience-execution-plan.md), using
its product requirements and rechecking its source assumptions against the pin.

1. Integrate a browser frame through the smallest checked composition adapter.
   Reuse upstream navigation groups, active content, callbacks, and forms.
2. Make settings occupy the available viewport at desktop, tablet, and phone
   sizes. Use safe-area padding and the existing visual-viewport conventions.
3. On narrow windows, show a category list and a category detail view in sequence.
   On wider windows, place navigation beside readable detail content.
4. Keep search, Close, detail Back, and configuration actions reachable. Keep
   navigation/header outside the effective detail scrolling area.
5. Preserve category, query, and form lifetime when resizing. Do not key an
   editable subtree on compact/wide mode merely to change its layout.
6. Scope the replacement to settings. Do not globally turn every upstream
   overlay into a full-screen surface.
7. Retain import/export/reset ownership until input lifetime and callbacks are
   understood. Moving a button must not point it at an unmounted file input.

Acceptance: phone, short landscape, tablet, and desktop layouts work with
keyboard/touch and increased scale; the audit's pending-save scenarios remain
safe; settings Close restores the same conversation and draft; nested picker
focus and Escape order work.

Rollback: revert frame composition and scoped styling while retaining existing
configuration and browser keys. Keep a save-safety fix independently reversible
from presentation if it is needed outside the new frame.

### Delivery E: settings presentation policy

Use one typed local policy with exceptions keyed by stable upstream identities.
Start with no arbitrary hidden defaults. Any actual default visibility changes
need product justification during implementation.

Required semantics:

- Unspecified upstream sections and fields inherit their normal behavior.
- Explicitly ordered sections precede unspecified sections while preserving
  the latter's upstream relative order.
- A hidden parent hides descendants. Empty groups disappear from navigation.
- Advanced fields remain reachable under disclosure. Search can reveal the
  disclosure before focusing a supported field.
- Browser-unavailable capabilities remain unavailable regardless of policy.
- Navigation, search, direct links, and content resolve against the same policy.
- A hidden/stale destination returns to a visible settings destination with an
  explanation. If nothing is visible, retain an explanatory home and Close.
- Filtering operates on complete field blocks, including help/dependent controls.
- Hidden and unknown configuration keys survive edits, import/export, and reset
  according to the existing upstream command semantics.
- Missing optional/provider-specific fields do not crash production. Stale
  policy IDs yield useful development or upgrade-review diagnostics.

Support schema-backed fields first. Bespoke settings controls may require their
own explicit adapter IDs; document unsupported customization rather than using
labels, array indexes, or `nth-child` selectors. Do not claim automatic display
of every backend schema key: upstream section definitions are also an input.

Acceptance: inheritance, parent precedence, target fallback, and value retention
work. Verify visible edits in the correct profile while a hidden value and an
unknown key remain intact. Removing overrides restores upstream presentation.

### Delivery F: explicit interaction hooks

Start with the project-action utility-class detection in `navigation.tsx`.
Replace it with an explicit navigation intent at the clicked action boundary,
retaining the existing rule about whether navigation stays open after selection.
Use a checked upstream composition hook if a wrapper callback cannot reach it.

Then address one affected interaction at a time:

- Render desktop menus and phone sheets from the existing `BrowserActionSurface`
  command model. Preserve checked, disabled, destructive, submenu, and
  after-close semantics.
- Use `BrowserToolbarButton`, `BrowserModal`, and existing focus helpers for
  browser-owned controls. Keep upstream accessibility primitives where useful.
- Introduce stable semantic hooks when browser CSS needs to target upstream
  content. Keep any necessary insertion transform reviewed and narrow.
- Keep responsive layout detection separate from coarse-pointer density.
  Wide touch tablets must not inherit phone layout just to get larger controls.

Acceptance: the converted behavior no longer depends on rendered wording,
utility class names, or which icon happens to be present. Keyboard and touch
commands retain scope, errors, and focus restoration. Avoid tests that merely
assert copied CSS values or component markup.

### Delivery G: one panel-composition experiment

Choose one auxiliary panel after mapping its ownership. Files is a candidate;
use another if Files has inseparable engine state. Selection should favor a
panel with clear open/close commands and a known lifecycle.

Record how its contribution mounts, receives context, stores open state,
interacts with the pane tree, restores preferences, and returns focus. Determine
whether it can be composed independently using upstream content and commands.

The experiment should expose a browser-facing description and an explicit
placement decision without mounting the contribution twice. Reuse the owning
renderer state. Do not add a permanent second panel-visibility store or rewrite
the whole tree just to prove the idea.

Prove opening, closing, reopening, resize, and conversation changes. Check that
the conversation instance and unsent attachments remain intact, relevant panel
state survives as before, and narrow presentation retains a usable close action.

Proceed to H only if the seam removes meaningful coupling without copying
upstream pane behavior. Otherwise retain `browserWorkspaceTree` and concentrate
on adapter clarity. This is an acceptable outcome, not an incomplete migration.

### Delivery H: incremental workspace composition

If G succeeds, migrate one supported responsibility per PR: panel description,
placement, open/close presentation, then any additional surface with comparable
ownership. Keep engine contribution registration and content lifetimes intact.

The target has a persistent conversation surface, browser navigation, and
explicit auxiliary surfaces. Reaching that target may still require the current
pane-tree adapter for engine content. Do not promise complete elimination of
desktop layout code without evidence from each remaining responsibility.

Keep `browser-routes.tsx` until an equivalent arrangement preserves one mounted
workspace behind settings/tools, route history, direct entry, and focus. Retain
session-tile cleanup and tab-suppression transforms until their removal cannot
restore hidden desktop behavior.

If a persisted placement shape must change, propose that migration separately:
inventory keys, preserve readable old data, avoid destructive rewrites, and
prove rollback can read the resulting state. Default to no persisted-format
change during this sequence.

Acceptance: migrated surfaces preserve user state and tool behavior; each
removed dependency has a replacement and relevant verification. Engine behavior
that lacks a supported seam stays inside the adapter.

### Delivery I: retire superseded integration

Perform cleanup in the same delivery that proves a replacement whenever possible.

1. Remove obsolete transform handlers, registrations, selectors, and exports.
2. Retain unrelated contracts and review any affected transform-chain hashes.
3. Update declared behavioral references and removal conditions.
4. Regenerate inventory/alias outputs only when their authored registry changes.
5. Update the styling guide and user-facing instructions if usage changed.
6. Clearly mark replaced planning sections as delivered or historical when
   authorized to update those documents. Keep active release guidance separate
   from implementation notes.

Complete renderer-transform elimination is outside this plan. If an upstream
extension point would remove a substantial local patch, record a concrete API
need with its current caller and semantics. Do not require upstream adoption to
deliver useful local improvements.

## 7. Validation strategy

### Normal implementation checks

For application changes, run:

```sh
pnpm typecheck
pnpm build
```

Then manually exercise the affected workflow. When compatibility entries,
replacement imports, or transforms change, also run the relevant checks:

```sh
pnpm check:renderer
pnpm check:compatibility-registry
pnpm check:upstream
```

After reviewing registry/fingerprint changes, regenerate existing outputs with:

```sh
pnpm docs:compatibility
```

Inspect that diff. Generation does not accept new fingerprints. Do not change
the renderer pin while migrating a browser component unless separately scoped.

### Targeted evidence by risk

| Change | Useful existing checks | Manual or focused browser scenario |
| --- | --- | --- |
| Adapter imports and commands | `scripts/adapter.test.mjs`, relevant selection/approval checks | Project action and approval change retain the correct owner. |
| Conversation/selection integration | Conversation model, selection owner, selection and roster-selection tests | Rapid session/Bot/group choices; latest intent wins. |
| Settings composition/policy | Extend only relevant behavior or pure policy tests | Pending edits, profile scope, search, hidden values, import/reset, Back/Close. |
| Menus/focus/navigation | Existing browser menu, dialog, and style scenarios | Keyboard menu, phone sheet, nested picker, Escape, focus return. |
| Workspace/panel placement | Existing workspace contracts and affected browser scenarios | One live composer; attachments/recording survive cover/uncover and resize. |
| Draft/readiness/update integration | Draft persistence, state safety, PWA registration, update network/coordinator tests | Conflicting tabs, save rejection, client changes, abort and retry. |

For example, these focused files can be selected when their behavior changes:

```sh
node --test scripts/conversation-model.test.mjs scripts/selection-owner.test.mjs
node --test scripts/draft-persistence.test.mjs scripts/state-safety.test.mjs
node --test scripts/pwa-registration.test.mjs scripts/update-network.test.mjs scripts/update-coordinator.test.mjs
```

The adapter file performs initialization work before individual tests, so a
name-filtered invocation may still do more than one small assertion. Diagnose
the baseline failure before relying on it as evidence.

Use the existing URL-based browser mode against a running synthetic preview for
focused UI scenarios, for example:

```sh
HERMES_BROWSER_PREVIEW_URL=http://127.0.0.1:5174 pnpm exec playwright test tests/browser/browser.spec.mjs --project=chromium --grep 'settings actions retain drafts'
```

The server must actually use the synthetic gateway. That existing scenario is a
starting point, not proof of the complete new settings behavior. A skipped run
is not a pass. Confirm the selected scenarios and inspect results.

For changes to worker activation or nginx-dependent authentication/recovery,
prefer a focused built-image journey with `HERMES_TEST_IMAGE`. The immutable
baseline upgrade suite is available when useful, following `releases.md`.
Build images in GitHub Actions in accordance with repository policy; do not
perform Nix builds on the VPS. No full browser suite, staged image promotion,
release-evidence record, or physical-device acceptance is added for routine work.

### Interaction matrix

Exercise the affected subset, not every combination for every PR:

| Situation | Expected behavior |
| --- | --- |
| 320/390px phone widths and short landscape | Reachable navigation, close controls, forms, and scrolling. |
| Around 768px boundary; 1024px tablet; 1440px desktop | Appropriate composition; coarse-pointer density independent of layout. |
| 100%/150% app scale; light/dark themes | Readable labels, visible focus, correctly positioned portals and controls. |
| On-screen keyboard and viewport panning | Focused field and exit/navigation controls remain reachable. |
| Active response, recording, or unsent attachment | Tool/settings navigation preserves lifetime; updates remain deferred. |
| Immediate exit after edit; delayed/rejected save | Correct profile retains edits or exit is deferred with visible recovery. |
| Two tabs editing different or identical sessions | Existing merge/conflict protection remains intact. |
| New tab during preparation; older tab; timeout | Activation postpones safely and restores interaction. |
| Browser Back, refresh, and direct tool/settings entry | Valid destination and predictable return to a usable conversation. |

Screenshots are useful for changed presentation; a screenshot does not prove
saved values, selection ownership, or recording continuity. Emulation is useful
without claiming physical-device coverage.

## 8. Compatibility, release, and rollback

Keep feature work on `origin` branches and open reviewable PRs there. Push after
meaningful commits as required by AGENTS.md. Do not alter repository settings or
enable renderer proposals as part of this sequence.

The active release workflow builds and publishes in GitHub Actions. A push to
main also deploys that run's exact image digest with container-health rollback.
Container health proves nginx responds; it does not prove configuration saves,
selection ownership, or browser rendering. Manually exercise the changed feature
when deployment is separately authorized.

Each PR should report the resulting behavior, relevant checks and outcomes,
remaining limitations, and any storage/wire compatibility implications. Keep
renderer upgrades separate where practical so compatibility failures can be
attributed to one change.

Rollback should normally require only reverting wrapper code or deploying the
previous immutable image digest using `releases.md`. Preserve runtime settings,
volumes, cookies, and local storage. Never clear drafts or credentials as a
migration step. Do not rebuild an old commit as a substitute for the previous
known image.

Keep no-format-change presentation PRs separate from any later storage or worker
protocol migration. Before introducing a versioned format, verify both forward
operation and behavior after a rollback. Existing installed clients can remain
active after deployment; account for that in update-related changes.

## 9. Decisions deferred until evidence exists

| Decision | Evidence needed | Default until resolved |
| --- | --- | --- |
| Does settings need an explicit flush interface? | Debounce/unmount/profile/update scenarios and the real save owner | Preserve upstream behavior; fix a demonstrated gap narrowly. |
| Can a flush coexist safely with the network barrier? | Request-admission order, pending queue ownership, races/timeouts | Delay activation until normal saves complete. |
| Can a panel mount independently? | One contribution lifecycle experiment | Keep the projected upstream tree. |
| Can more engine transforms be removed? | A supported composition/API seam and behavior parity | Retain reviewed fingerprints and transforms. |
| Should CSS zoom be replaced? | Isolated portal, viewport, typography, stored-scale, and WebKit comparison | Keep existing zoom and compensation rules. |
| Does capability modeling need consolidation? | Actual overlapping policy decisions across settings/menu/panel consumers | Use current helpers; avoid another global policy registry. |
| Should dependencies be trimmed? | Reachable renderer import/build evidence and compatibility verification | Keep the locked dependency set; do not infer unused packages from names. |

CSS zoom replacement is exploratory and outside the core PR sequence. Removing
Node from the nginx image, adding build systems, rewriting authentication, or
introducing offline chat would expand scope without solving the identified
ownership problems. Keep the shared runtime configuration generator and current
build paths.

## 10. First implementation handoff and completion

Start with Delivery A and the research portion of B:

1. Recheck branch, local changes, renderer pin, and actual workflow files.
2. Reuse a suitable checkout; isolate implementation only when needed, using
   managed worktree tools. Preserve existing unfinished work.
3. Diagnose the adapter test failure without weakening its import rules.
4. Move project and settings-menu renderer access through narrow adapters.
5. Verify scoped commands and the relevant browser interactions.
6. Map pending settings saves and capture evidence for the smallest next change.
7. Report what was verified, what remains uncertain, and the next useful PR.

The migration is complete for its chosen scope when browser-owned features use
explicit adapters, supported settings presentation is consistent, proven pending
work is protected, and replaced compatibility code is retired. Broader workspace
replacement remains conditional on its experiment. A retained adapter with a
clear owner and reviewed contract is preferable to a speculative rewrite.

Documentation preparation made no application, generated-asset, release,
automation, or renderer-pin changes. Review-era checks above are historical
evidence; rerun relevant checks against each implementation diff.
