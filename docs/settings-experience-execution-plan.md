# Full-screen settings implementation plan

Status: responsive frame implemented; declarative presentation policy and live browser verification remain.
Prepared: 2026-09-28; status updated 2026-09-29.

## 1. Outcome and scope

Replace the settings presentation with one responsive, full-screen modal on
phones, tablets, and desktop. This is an application modal covering the browser
viewport, not the browser Fullscreen API. The conversation remains mounted
underneath it. Closing settings returns to the previous conversation and draft.

The user wants to customize the layout and hide options while continuing to
receive upstream improvements. Deliver the new presentation first, followed by
one small, declarative visibility policy. Preserve upstream setting controls,
validation, profile ownership, and persistence wherever possible.

Confirmed requirements:

- The new experience applies to desktop and tablets as well as phones.
- Settings occupies the full available viewport at every size, without the
  current desktop card margins, rounded outer window, or backdrop gutter.
- Narrow windows show a category list and a category detail page sequentially.
- Wider windows show category navigation alongside the active detail page.
- Search, close, navigation, forms, and configuration actions remain usable with
  touch, a keyboard, text scaling, and an on-screen keyboard.
- Customization defaults apply to all screen sizes. Device-specific exceptions
  are optional, explicit rules rather than separate settings implementations.
- Upstream sources remain unmodified; compatibility changes live in this repo.

Do not implement a new settings backend, duplicate the configuration store, copy
all upstream settings pages, or replace the chat engine. An in-app customization
editor and synchronized personal visibility preferences are later enhancements.
The first customization interface is a documented local policy file.

Automatic renderer-update proposals are a separate follow-up. Do not enable
automation, change repository settings, merge, or deploy as part of the UI work.

## 2. Repository facts to verify before editing

This plan is based on the renderer pinned to
`03b0c7947262b220f5148b75a30bb7a3faddcbb2`. The local renderer matched that pin
during inspection. Recheck the current branch and pin before implementation.
At handoff, the working branch was `codex/sidebar-control-spacing`; do not assume
that branch is the correct base for this feature or include its unrelated work.

Read `AGENTS.md`, `docs/releases.md`, and `docs/upstream-updates.md`. Older reset
plans are background, not additional acceptance gates. Use a clean feature branch
with the `codex/` prefix, based on current `origin/main`, and preserve unrelated
work. Reuse a suitable checkout; use managed worktree tools if isolation is needed.

Important existing code:

| Path | Role and implementation implication |
| --- | --- |
| `apps/desktop/src/app/settings/index.tsx` | Builds `navGroups`, `activeSettingsContent`, search, export/reset callbacks, and an import input ref. Keep its upstream page-selection logic. |
| `apps/desktop/src/app/overlays/overlay-view.tsx` | Current desktop-style outer frame, Escape handling, and overlay marker. It is shared with unrelated pages; do not globally make every overlay full-screen. |
| `apps/desktop/src/app/overlays/overlay-split-layout.tsx` | Sidebar on wide screens and a crowded category dropdown/action bar on narrow screens. Replace this composition for settings only. |
| `apps/desktop/src/app/settings/primitives.tsx` | Shared settings rows and scrolling containers. Some rows already stack using container queries. |
| `apps/desktop/src/app/settings/constants.ts` | Explicit `SECTIONS` definitions and their field keys. |
| `apps/desktop/src/app/settings/helpers.ts` | `sectionFieldEntries` combines those explicit keys with schema/config data. It does not enumerate every backend field automatically. |
| `apps/desktop/src/app/settings/config-settings.tsx` | Profile-scoped config loading, debounced save queue, field rendering, and import input/handler. Preserve its persistence semantics. |
| `apps/desktop/src/app/settings/settings-search.ts` | Search entry/target contracts and some stable appearance IDs. Inspect the search hook and palette consumer too. |
| `apps/web-desktop/src/upstream/browser-plugin.ts` | Existing checked browser transforms and importer-scoped replacements. Preferred integration location. |
| `apps/web-desktop/src/upstream/compatibility-registry.json` | Declares source contracts, transform order, fingerprints, and behavioral verification references. |
| `apps/web-desktop/src/upstream/browser-routes.tsx` | Keeps the background workspace route mounted while an overlay is active. Retain this ownership. |
| `apps/web-desktop/src/experience/settings-menu.tsx` | Existing entry point into `/settings`. The small settings/workspace menu is separate from the full settings modal. |
| `apps/web-desktop/src/experience/ui/overlay-focus.ts` | Focus entry, containment, and return behavior for workspace overlays. |
| `apps/web-desktop/src/experience/ui/use-compact-browser.ts` | Existing compact layout detection. Prefer its width/short-landscape behavior over a new device detector. |
| `apps/web-desktop/src/platform/viewport.ts` | Publishes visual viewport height/top for keyboard resizing and panning. |
| `apps/web-desktop/src/web-overrides.css` | Existing viewport, UI-scale, portal, and safe-area adaptations. |
| `tests/browser/browser.spec.mjs` | Existing settings actions/draft/focus checks and browser fixture setup. |

All `apps/desktop` and `apps/shared` files above are read-only references.

## 3. Target interaction design

### Full-screen frame

- Use an opaque surface spanning the usable viewport, including desktop.
- Header contains a visible Settings title, accessible search entry, and an
  always-reachable close button. Keep desktop shortcut hints out of compact
  controls when they compete for space.
- On narrow detail pages, include Back to settings and the selected category
  title. Back returns to the category list; Close exits the entire modal.
- Use safe-area padding inside the surface, not external card margins.
- Follow the existing visual viewport and UI-scale conventions so the close
  button and focused field remain reachable when the keyboard opens.
- Keep navigation/header fixed within the modal. Give the detail body one
  effective vertical scroll area; avoid accidental nested scrolling.
- Use approximately 44 CSS-pixel touch targets at actual displayed scale and
  readable form text. Preserve the project's existing text-scale behavior.
- Match the app's theme and existing browser design tokens.

### Wide layout

- Start with a roughly 15rem category column, a flexible detail region, and a
  readable maximum width for form content. These are tuning values, not a new
  breakpoint system.
- Keep category navigation visible while detail content scrolls.
- Use existing upstream labels, icons, and child-category identities.
- Separate configuration management actions from routine setting rows.
- The modal fills the screen even when the form content is width-constrained.

### Compact layout

- Ordinary opening shows a searchable category list with generous row spacing.
- Selecting a category shows its detail content using the available width.
- A direct link to a category/field opens the corresponding detail immediately.
- Support narrow desktop windows and tablet split-screen using available space,
  not just coarse-pointer detection. Short landscape phones remain usable.
- Resize between layouts without losing the selected category, profile scope,
  scroll unnecessarily, or pending form input.

### Navigation, accessibility, and search

- Preserve existing `tab`, `pview`, `kview`, field/setting search parameters,
  and upstream redirects such as moved settings and the connections alias.
- Keep the upstream close callback as the owner of returning to the prior app
  context; do not hard-code a return to `/`.
- Define browser history explicitly: category Back stays inside settings;
  browser Back reverses settings navigation and ultimately exits the modal.
  Direct-link entry must still have a safe Close destination.
- Avoid injecting navigation history entries during resize or policy filtering.
- Use dialog semantics with an accessible title and modal focus containment.
  Make the background unavailable to keyboard interaction while preserving its
  mounted state. Reuse the existing focus owner; do not install competing traps.
- Preserve nested popup ownership. Escape closes a picker/search dialog before
  closing settings. Restore focus to a connected, visible settings trigger when
  possible, with a sensible fallback for direct-link or keyboard entry.
- Start by reusing the upstream settings search/palette behind a large, visible
  search control. Do not build a second search index just to change the layout.

## 4. Integration design

Add a browser-owned settings frame that receives upstream navigation and content
instead of replacing the entire upstream settings module.

Suggested files, to be consolidated if smaller existing modules fit better:

| Proposed file | Responsibility |
| --- | --- |
| `apps/web-desktop/src/experience/settings/frame.tsx` | Full-screen frame, compact list/detail composition, and wide navigation. |
| `apps/web-desktop/src/experience/settings/settings.css` | Scoped layout and control sizing. Import through the existing stylesheet entry. |
| `apps/web-desktop/src/experience/settings/policy.ts` | Single source of customization rules and documented defaults. |
| `apps/web-desktop/src/upstream/settings-presentation.ts` | Small adapter translating upstream section/search identities into presentation rules. |

Preferred implementation seam:

1. Add one checked transform for `app/settings/index.tsx` that imports the local
   frame and replaces only its final overlay/layout composition.
2. Pass `navGroups`, `activeSettingsContent`, search control, configuration
   actions, and `onClose` into that frame. Pass existing localized title strings
   and navigation metadata as needed.
3. Retain upstream creation of sections, controls, save callbacks, and special
   pages. Newly added upstream pages then continue to reach the frame.
4. If a settings-scoped component replacement provides an equally narrow seam,
   use the existing importer-scoped resolver. Never replace the shared overlay
   for every importer just to implement settings.
5. Register every added seam in the compatibility registry and fail clearly when
   its expected source shape changes. Do not make unchecked global replacements.

The local frame may reuse the upstream overlay lifecycle with a scoped frame
adapter, or use the existing browser modal/focus primitives. Pick one owner for
Escape and focus. Inspect portaled menus before choosing a modal primitive;
search and provider pickers must remain interactive outside the frame's DOM.

Do not remount the active upstream page simply to change responsive layout.
Keep a stable content slot. Audit category changes and Close against the current
550ms config-save debounce: navigation must not discard pending changes. Reuse
or extend the existing save owner only where needed, without adding a parallel
configuration store or resetting pending work through presentation keys.

## 5. Customization policy

Use one typed policy file containing exceptions to upstream behavior. Example
API, to finalize during implementation:

```ts
export const settingsPolicy = {
  sections: {
    'config:appearance': { order: 10 },
    'config:model': { order: 20 },
    keybinds: { hiddenOnCompact: true },
  },
  fields: {
    'appearance.ui-scale': { hidden: true },
    'compression.threshold': { advanced: true },
  },
}
```

These entries demonstrate the format, not an approved list of options to hide.
Start with existing functional options available unless browser capabilities
already exclude them. Document real examples so customization is straightforward.

Policy rules:

- Known IDs with overrides use those overrides. Unspecified entries inherit
  upstream labels, availability, and relative order.
- Unordered new sections remain reachable after explicitly ordered sections.
- A hidden parent also hides its children. Hide empty groups after filtering.
- Global hiding takes precedence over a compact-only rule. An option unavailable
  in the browser cannot be enabled by a presentation preference.
- `advanced` means reachable under an explicit disclosure, not hidden. Search
  may reveal advanced results and open the disclosure before focusing a field.
- Hiding a setting never deletes, resets, exports differently, or rewrites its
  stored configuration value. This is presentation, not authorization.
- Schema-driven fields use canonical schema keys. Non-schema settings use
  existing stable IDs where available and explicit adapter identities otherwise.
  Never identify a setting by translated label, array position, or `nth-child`.
- Filter a complete field block, including dependent controls/help, rather than
  hiding only the input and leaving an empty row or orphaned subpanel.
- Apply visibility to category navigation, settings search, and direct-link
  resolution consistently. A hidden target falls back to a visible settings
  destination with a short explanation; do not silently redirect to chat.
- If rules hide every normal category, retain an explanatory settings home and
  Close rather than selecting an invalid page or rendering a blank modal.
- Removed/renamed IDs should generate actionable development or upgrade-review
  diagnostics. Do not crash a production page because an optional field is absent
  for a particular profile/provider.

Schema-generated controls are the easiest first integration. Appearance and
specialized pages contain bespoke controls and not every row exposes a stable
ID. Add explicit, small adapters for requested controls; do not claim universal
field customization before those controls are supported.

## 6. Configuration management actions

The intended destination is a labelled Manage configuration area, containing
Import, Export, and Reset with text labels and the upstream reset confirmation.

There is an integration constraint: the current import input and handler live
inside `ConfigSettings`, while its ref and toolbar action originate in the
settings entry point. Moving the action alone can leave a button pointing to an
unmounted input on Appearance, Providers, or other specialized pages.

For the first layout PR, preserve functional action ownership and present those
actions in an accessible labelled area. Before moving them to a separate page,
verify input lifetime, profile scope, file-picker user-activation requirements,
and pending saves. Factor/reuse upstream handling through a narrow adapter if
needed. Do not duplicate import/reset logic or silently offer a dead action.
Keep import/export errors and destructive confirmations visible in the modal.

## 7. Delivery sequence

### PR 1: Full-screen responsive settings

1. Inspect current upstream/settings integration and establish a browser baseline
   at phone, tablet, and desktop widths.
2. Add the local frame and the smallest checked composition adapter.
3. Implement full-screen geometry, accessible header, compact navigation, wide
   sidebar, and usable content scrolling.
4. Retain upstream pages, route targets, search, callbacks, and profile behavior.
5. Audit pending saves, focus, nested menus, Back/Close, and draft preservation.
6. Update compatibility registration and generated inventory for the new seam.
7. Typecheck, build, and exercise the affected workflows.

Completion: every supported viewport gets the new modal, core settings remain
usable, and closing returns to the same chat state. No visibility policy is
required to make this PR useful independently.

### PR 2: Declarative customization

1. Add the typed policy and small presentation adapter.
2. Apply section ordering/visibility, then schema-field visibility and advanced
   disclosure. Add specific non-schema adapters only where needed.
3. Apply the same policy to upstream search targets and direct-link resolution.
4. Add lightweight diagnostics for stale IDs with appropriate handling of
   conditional/provider-specific availability.
5. Document where to customize, precedence, examples, and unsupported bespoke
   fields. Include a way to restore defaults by removing policy overrides.
6. Check that hiding fields preserves their values and that visible edits save
   without dropping hidden or unknown configuration keys.

Completion: common customization requires editing one policy file, and new
upstream UI entries inherit defaults without updating a duplicate local catalog.

### Separate follow-up: Upstream update proposals

The renderer remains pinned through `flake.lock`. UI inheritance takes effect
when that pin is upgraded; it does not make the app track upstream HEAD at runtime.
Backend schema changes and renderer changes are distinct inputs.

If automatic proposals are subsequently requested:

1. Inspect `.github/workflows/renderer-update.yml`, updater scripts, and
   `docs/upstream-updates.md` against the active release workflow.
2. Propose a minimal scheduled pin-update PR workflow with compatibility,
   typecheck, and build validation. Do not resurrect historical staged promotion
   requirements or silently enable auto-merge.
3. Include a settings change summary: new/removed sections, affected field IDs,
   and changed adapter contracts where discoverable.
4. Leave changed compatibility contracts for review and repair; never refresh
   fingerprints automatically to make an incompatible renderer pass.
5. Keep merge/deployment separate from update detection. Follow current explicit
   authorization for any automation activation or repository configuration.

The current upstream field grouping is explicit. New fields exposed by upstream
settings inherit the wrapper policy. New backend-only keys are not automatically
promised a UI, and bespoke upstream changes may still need a small adapter fix.

## 8. Validation and acceptance

Use the existing preview gateway and browser tooling described in
`docs/browser-preview.md`. Do not rely on real credentials or production data.

Required implementation checks:

```sh
pnpm check:renderer
pnpm check:compatibility-registry
pnpm check:upstream
pnpm typecheck
pnpm build
```

When registry entries change, regenerate the inventory with
`pnpm docs:compatibility` after reviewing source and transform fingerprints.
That command does not calculate or accept new fingerprints automatically.

Run a focused browser regression for settings focus/draft behavior with the
configured preview URL or test image. For example, with a running preview:

```sh
HERMES_BROWSER_PREVIEW_URL=http://127.0.0.1:5174 pnpm exec playwright test tests/browser/browser.spec.mjs --project=chromium --grep 'settings actions retain drafts'
```

This existing test is a starting point, not evidence that the new full settings
flow is covered. Inspect and extend the relevant scenario only where behavior
such as saving, route state, or focus requires it. The suite can skip without a
configured target; a skipped run is not a pass.

Manual/browser viewport checks:

| Scenario | Expected result |
| --- | --- |
| 320/390px phone widths | Full-screen surface, usable categories/forms, no horizontal page overflow. |
| Short landscape phone | Navigation and Close remain reachable; detail content scrolls. |
| 768/1024px tablet widths | Responsive list/detail or sidebar layout without squeezed controls. |
| 1440px desktop | Full-screen surface with sidebar and readable form width. |
| Text/UI scale increase and tablet split-screen | Labels, controls, search, and Close do not overlap or clip. |
| On-screen keyboard and viewport panning | Focused field and navigation stay reachable; no extra body scroll. |
| Category switch, resize, and Close after an edit | No lost pending input/save; no unintended profile writes. |
| Open while chat has text/attachments | Closing restores the same conversation and draft. |
| Search and nested provider/model picker | Correct focus ownership and Escape order. |
| Deep link, refresh, browser Back, and direct entry | Valid settings target and predictable return behavior. |
| Import/export/reset | Correct profile, working file selection/download, retained confirmation and errors. |
| Hidden section/field and stale direct link | Consistent policy across navigation/search/detail; values retained. |
| New upstream entry without a policy rule | Inherits upstream visibility and appears in a reachable position. |

Add focused policy tests for inheritance, hidden-parent precedence, stale-target
fallback, and value preservation if that code touches persistence. Add or extend
a behavior test for pending-save loss if the frame affects mounting/navigation.
Do not add tests that only mirror CSS declarations or run every unrelated suite.
The compatibility registry requires real behavioral references; point to an
existing relevant scenario or add a focused one for the new integration.

Capture actual screenshots at phone, tablet, and desktop sizes for review.
Report browser/fixture coverage accurately. Keyboard/device emulation does not
prove every physical-device behavior; real-device testing is useful when
available, not a required release gate for this work.

## 9. Completion, handoff, and rollback

For each implementation PR, report what changed, exact checks and outcomes,
screenshots, and any remaining unsupported settings or browser behavior. Keep
feature work on `origin`, push meaningful commits, and open a reviewable PR.
Do not merge or deploy unless explicitly requested.

Rollback of presentation/policy code must not require clearing local storage,
rewriting config, or changing backend data. If a deployed version regresses,
use the previous immutable image digest according to `docs/releases.md` and
preserve runtime configuration and volumes.

Handoff evidence: source inspection and renderer-pin verification only. No new
modal, customization code, test execution, browser visual verification, renderer
upgrade, or automation activation was performed while writing this plan.
