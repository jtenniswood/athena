# Settings architecture: execution plan

Status: planned; implementation has not started.

Baseline: `codex/settings-fullscreen` at `ba5edd6`, reviewed on September 29,
2026. The renderer pin is
`03b0c7947262b220f5148b75a30bb7a3faddcbb2`. Recheck both revisions and local
changes before implementation. This document plans the settings expert-reset
recommendations; it does not claim they have been implemented or validated.

## 1. Outcome

Hermes Web owns the settings experience through a settings catalog, a responsive
fullscreen shell, and a narrow adapter to upstream forms. Customization becomes
an edit to presentation data wherever possible. Hermes remains authoritative for
configuration values, profile state, validation, and saving.

The migration must retain the existing product behavior while reducing the
number of upstream source edits required for layout and policy changes.

There are two distinct upgrade promises:

1. When the renderer or connected server supplies new settings, the wrapper
   inherits entries that have no explicit local override.
2. Updating the renderer pin incorporates a new upstream UI revision after its
   compatibility assumptions are reviewed.

The first is a catalog requirement. The second remains the existing reviewed
upgrade workflow. This plan does not enable automated renderer proposals,
automatic merges, or production deployment. Follow
[releases and rollback](releases.md) and
[upstream updates](upstream-updates.md), rather than the release gates in older
reset documents.

## 2. Product contract

Preserve all of the following throughout the migration:

- Settings is a fullscreen modal on phones, tablets, and desktop.
- Desktop displays `Settings` as the main header title, without a leading gear.
- Compact navigation displays the menu first and provides a back control from
  section detail. Direct search targets may open detail immediately.
- Search uses an icon on every screen size and appears only on the menu view
  in compact layouts.
- Navigation uses the five current groups, current ordering, title case, and
  current single-name group headings.
- Navigation density, spacing, icon sizes, theme, and focus styling match the
  browser service's existing design contract.
- About stays hidden by default.
- Configuration remains a separate page for export, import, and reset.
- Configuration has no profile picker. It may display the target profile as
  read-only information.
- Existing upstream profile selectors on other relevant settings pages remain
  available. Their selection carries across pages as it does today.
- Renamed sections remain searchable by their old names.
- Existing page, subpage, and field links remain usable.
- Hidden fields retain their saved values. Visibility does not filter the
  configuration payload sent to the server.
- Unknown upstream pages have a useful fallback, and unknown upstream fields
  retain the section and renderer behavior assigned by upstream.
- Closing settings preserves the active chat, selected profile, composer draft,
  attachments, and recording lifetime. Settings does not remount the chat shell.
- Existing authentication recovery and safe PWA activation continue to work.

### Current grouping to retain

| Group | Sections, in order |
| --- | --- |
| Preferences | Appearance, Notifications, Keyboard Shortcuts |
| Assistant | Models, AI Connections, Chat, Voice, Memory |
| Tools | Workspace, Browser Automation, Permissions, Saved Logins, Credentials |
| Service | Server Connection, Billing |
| Maintenance | Archived Chats, Configuration, Advanced |
| Other Settings | Visible upstream pages not explicitly assigned to a group |

Provider and credential subpages retain their current route identities and
upstream actions. Do not flatten them in a way that removes access to a subpage.

## 3. Current implementation and pressure points

| Area | Evidence | Migration concern |
| --- | --- | --- |
| Presentation metadata | [policy.ts](../apps/web-desktop/src/experience/settings/policy.ts) | Groups, labels, aliases, ordering, and hidden rules are related but maintained as separate structures. |
| Shell and navigation | [frame.tsx](../apps/web-desktop/src/experience/settings/frame.tsx) | Upstream route state is combined with compact-view flags; page notices are embedded in the component. |
| Field visibility | `frame.tsx` and `filterBrowserSettingsFields` | Visibility is enforced through both upstream render filtering and a DOM observer. Custom controls require additional rules. |
| Upstream composition | [browser-plugin.ts](../apps/web-desktop/src/upstream/browser-plugin.ts) | Exact source replacements alter JSX layout, props, actions, navigation, and search. |
| Configuration actions | [configuration.tsx](../apps/web-desktop/src/experience/settings/configuration.tsx) and `useBrowserConfigurationSettings` | The local page is inserted into the upstream configuration form and receives controls from its former navigation footer. |
| Fullscreen geometry | [settings.css](../apps/web-desktop/src/experience/settings/settings.css) | Close-control placement and content scrolling depend on upstream class structure. |
| Server information | [connection.ts](../apps/web-desktop/src/platform/connection.ts) | The typed status response contains authentication information and version, not browser-installation or service capabilities. |
| Verification | [browser.spec.mjs](../tests/browser/browser.spec.mjs) | Some browser expectations still use sentence-case names after the title-case change. |

The current central policy, shared tokens, and guarded compatibility registry are
useful foundations. Migrate them incrementally instead of replacing everything
at once.

## 4. Ownership and dependency boundaries

| Owner | Responsibilities | Must not own |
| --- | --- | --- |
| Upstream Hermes | Configuration schema, values, validation, profile stores, caches, save behavior, existing page forms | Browser-specific grouping and modal layout |
| Upstream settings adapter | Translate upstream definitions, pages, targets, scopes, and actions into a wrapper interface | A second editable configuration or conversation store |
| Settings catalog | Local metadata overrides, resolved grouping, aliases, presentation visibility, scope explanations | Secrets, current field values, transport, autosave queues |
| Settings shell | Header, navigation, menu/detail presentation, page containment, focus transitions | Authentication, backend restarts, configuration writes |
| Browser platform | Connection, authentication, browser permission and feature information | Settings taxonomy or remote-host capability guesses |
| Existing release tooling | Pin verification, compatibility contracts, typecheck/build, image publication and rollback | Automatic acceptance of changed source fingerprints |

Feature components consume catalog entries and adapter interfaces. Imports of
upstream settings stores and private forms should be concentrated in the
adapter. Do not introduce another mutable configuration store, profile selector
store, conversation store, or parallel save queue.

Keep authentication recovery in the existing connection/startup ownership path.
The recovery changes already present on the feature branch are preserved; this
settings migration does not redesign the authentication state machine.

### Proposed file homes

These are proposed modules, not existing APIs. Create a file only when its
responsibility is needed; do not add empty scaffolding.

| Proposed home | Purpose |
| --- | --- |
| `src/experience/settings/catalog.ts` | Authored section, group, field, and custom-control overrides |
| `src/experience/settings/catalog-model.ts` | Pure catalog resolution, ordering, alias, and visibility functions |
| `src/experience/settings/contracts.ts` | Wrapper-facing settings target, scope, catalog, and support types |
| `src/experience/settings/navigation.ts` | Route parsing and explicit compact menu/detail transitions |
| `src/experience/settings/configuration.tsx` | Existing local Configuration page, consuming typed commands |
| `src/experience/settings/frame.tsx` | Fullscreen shell composition with minimal policy logic |
| `src/upstream/settings-adapter.tsx` | Existing form composition, profile projection, and upstream action bindings |
| `src/experience/ui/` | Shared navigation row and fullscreen containment primitives where two consumers benefit |
| `src/platform/` | Browser capability information, using existing feature owners where possible |

During migration, `policy.ts` remains a compatibility facade for existing callers.
Remove it only after all callers use the new catalog interface.

## 5. One settings catalog

### 5.1 Sources and precedence

Resolve the catalog from three sources:

1. Upstream definitions, configuration schema, search entries, and page actions.
2. Local presentation overrides for known sections, fields, and custom controls.
3. Availability information from the browser platform and, when provided, the
   connected server.

The server schema remains the source of truth for configuration field shape and
validation. Do not copy every upstream field into a local manifest.

Local descriptors may override title, group, order, aliases, scope explanation,
or visibility. They must not replace a field's saved value, validation rules, or
save action.

### 5.2 Descriptor responsibilities

Use one section descriptor containing:

- Stable page ID and existing route aliases.
- Optional local title and search aliases.
- Group ID and default order.
- Scope classification and optional explanatory copy.
- Presentation visibility preference.
- Capability requirements where a real capability is known.
- The adapter-owned renderer/action identity.
- Optional child destinations, including existing `pview` and `kview` targets.

Field overrides use canonical schema keys. Handwritten controls use explicit,
stable IDs, such as the existing Appearance setting IDs. Both kinds consume the
same resolved visibility decision.

Illustrative types, to refine against the actual adapter:

```ts
type SupportState = 'supported' | 'unsupported' | 'unknown'
type SettingsScope = 'browser' | 'connection' | 'instance' | 'profile' | 'mixed'

type SettingsTarget = {
  pageId: string
  providerView?: string
  keysView?: string
  fieldId?: string
  appearanceSettingId?: string
}

type SectionOverride = {
  id: string
  title?: string
  groupId?: string
  order?: number
  aliases?: readonly string[]
  scope?: SettingsScope
  scopeDescription?: string
  visibility?: 'inherit' | 'hidden'
  requires?: readonly string[]
}
```

Avoid a closed page-ID union that prevents new upstream entries from being
represented. Known constants can remain typed without rejecting unknown IDs.

### 5.3 Resolution rules

- Explicit presentation hiding removes an entry from navigation and settings
  search, without mutating stored configuration.
- Confirmed unsupported controls remain unavailable regardless of ordering or
  title overrides.
- Unknown server support does not become unsupported merely because the client
  is a browser.
- Known entries receive the requested titles and groups.
- Unassigned upstream pages appear under Other Settings in their upstream order.
- Unknown fields keep upstream section assignment and rendering behavior.
- Empty navigation groups do not render.
- Old titles remain aliases; they are not duplicate navigation entries.
- Page headings, navigation, search contexts, and command-palette page labels
  come from the same resolved catalog.
- A hidden field deep link resolves to a useful visible destination without
  rendering an editable hidden field. A hidden page link offers the menu or an
  explicit unavailable state while preserving unrelated URL state.
- A server changing schemas must invalidate the appropriate catalog projection;
  do not reuse another connection or profile's availability result.

Validate unique IDs, known group references, duplicate destinations, and alias
collisions that would create ambiguous navigation. Use warnings or fallback for
previously unknown upstream entries rather than rejecting them solely for being
new.

### 5.4 Consumer migration

Move consumers in this order:

1. Section grouping, order, headings, and page notices.
2. Page entries in the existing command palette.
3. Field and Appearance entries in the existing settings search catalog.
4. Generic configuration-field filtering.
5. Handwritten controls, including Appearance, advanced device preferences,
   theme installation, and archived-chat directory controls.
6. Direct-link availability handling.

Reuse upstream search actions and matching behavior. Do not build a second
search engine. Plugin and credential search must preserve their existing
destinations and scope; only apply rules that actually describe those entries.

## 6. Capability and scope rules

### 6.1 Separate availability from preference

Record why a control is unavailable or hidden. At minimum distinguish:

- A browser implementation does not exist.
- A browser feature exists but permission or context currently blocks use.
- A server feature is explicitly unsupported.
- A server feature's runtime support is unknown.
- The owner intentionally hid a supported or inherited option.

This distinction is internal metadata. Surface explanatory text only where it
helps the user make a meaningful decision.

Browser permission denial is not permanent lack of capability. Notifications
and microphone settings should retain an appropriate permission/recovery path
instead of disappearing simply because permission is denied.

### 6.2 Browser capabilities

Derive browser availability from actual platform implementations. Review the
bridge and existing feature owners before classifying a setting.

Retain hiding for confirmed unimplemented controls such as native Quick Entry,
the native folder picker, backend process-pool controls, and unsupported native
window effects. Keep supported browser preferences available.

Classify every currently hidden field and custom control; do not assume all
fields with a desktop-related name are unsupported. Remote repository discovery
is one example of a setting whose name alone does not establish its location.

### 6.3 Server capabilities

Use server capability information only if an existing endpoint or schema
actually supplies it. This plan does not require changes to the separate Hermes
server or invent a new mandatory API.

Store a support decision together with its evidence/source. A version string or
configuration key can establish that configuration is recognized; it cannot
prove that the server has a browser binary, a logged-in browser profile, or a
Nous billing account.

For `browser.use_real_profile`:

- Keep the control available when the server recognizes the setting and no
  explicit unsupported capability is reported.
- Explain that it uses the browser profile on the connected Hermes server.
- Treat the server's browser installation and profile availability as unknown
  until the server provides reliable information.
- Preserve server errors and upstream confirmation/consent behavior.
- Never attempt to read the viewing device's browser profile.

For Billing, saved logins, remote browser automation, and remote update policy,
record the actual owner and runtime dependency. Decide visibility from evidence
and curation preferences; do not equate optional service use with lack of web
support.

### 6.4 Configuration target

Read scope from the existing upstream settings/profile stores. Configuration
shows a read-only label identifying its current target, including the profile
when it is meaningful. Keep its profile picker removed.

The adapter must preserve the difference between upstream `null` and
`undefined` profile arguments. In the current API helpers, `undefined` can mean
follow the active profile, while `null` can deliberately select the primary
target. Do not pass a raw selector override to a request helper.

For delayed or confirmed commands, capture a concrete target at invocation and
resolve the correct API arguments for that captured identity. Keeping an
unresolved `undefined` until after a confirmation can accidentally follow a new
active profile. Test default-profile and non-default-profile behavior explicitly.

Do not add a second connection registry. The wrapper's existing single-gateway
connection model remains authoritative.

## 7. Upstream adapter and page composition

### 7.1 Required surface

The adapter should expose the following through React hooks or typed bindings,
using existing upstream state rather than copying it:

- Available page definitions and their existing identities.
- Existing page renderers and the callbacks those pages need.
- Normalized route destinations and subpage targets.
- Current configuration scope and a way to resolve a captured command target.
- Existing settings search entries/actions.
- Configuration action bindings and relevant readiness/pending state.
- Upstream loading, failure, retry, and save feedback.

An illustrative hook result might contain `definitions`, `scope`, `renderPage`,
`search`, and `configurationCommands`. These names are proposals. Confirm the
actual upstream exports and lifecycle before committing to an interface.

`renderPage` returns ordinary page components; it must not invoke hooks
conditionally inside an arbitrary callback. Preserve upstream keys and remount
boundaries that distinguish profiles and page owners.

### 7.2 Feasibility experiment before broad migration

At the fixed renderer pin:

1. Map exports for ConfigSettings, Models, Chat, Appearance, Providers, Keys,
   Notifications, Sessions, Billing, Vault, and Gateway settings.
2. Identify the source of non-config page definitions, route aliases, actions,
   and profile scope. Several currently live inside the upstream SettingsView.
3. Render Models and Chat through a small adapter in the existing shell.
4. Exercise a warm cache, a cold cache, scope switching, save/reopen, and request
   failure/retry.
5. Demonstrate how an upstream page not known to the local catalog obtains an
   actual renderer, rather than only a new navigation row.

Prefer existing exports. If upstream lacks a reusable controller/catalog export,
a single checked build seam may expose that model to the wrapper. All authored
code stays in the wrapper. Structural extraction, if needed, must be reviewed
against the pinned source and retain compatibility fingerprints.

An AST-based edit can reduce dependence on whitespace, but it does not remove
semantic coupling. Do not adopt a parser or code generator merely to rename the
current collection of string replacements.

### 7.3 Unknown-page continuity

Do not replace the upstream controller with a permanently hardcoded list of
known page imports while claiming automatic inheritance.

Use one of these paths, chosen after the feasibility experiment:

1. Consume an upstream registry/factory that enumerates and renders pages.
2. Expose the existing upstream inventory and renderer through the checked seam.
3. Keep the legacy upstream controller as the adapter fallback for unmigrated
   and unknown pages until a smaller complete contract is available.

The fallback is adapter-owned. It must not create a nested settings modal or
duplicate navigation, configuration state, or route state.

If a smaller complete boundary is not feasible at the current pin, deliver the
catalog and scope improvements first, retain the checked legacy adapter, and
document the constraint. Do not fork the renderer or silently lose future pages
to finish this migration.

### 7.4 Page migration order

1. Models and Chat, through ConfigSettings: prove initialization and saves.
2. Remaining schema-backed config sections, retaining generic field behavior.
3. Appearance and its handwritten controls.
4. Notifications and Keyboard Shortcuts.
5. Providers and Credentials, preserving child routes and profile ownership.
6. Browser-related pages, Vault, Sessions, and Billing, preserving service errors.
7. Gateway settings and the local Configuration page.
8. Remaining unknown-page fallback and legacy-controller removal, if supported.

Move fewer pages per commit when their ownership differs. Do not replace a
complex form with a handwritten equivalent just to complete this list.

## 8. Navigation and shared fullscreen UI

### 8.1 State model

Keep the existing route as the authority for selected page, subpage, and field
targets. A small explicit presentation state controls whether compact layout is
showing the menu or detail. It does not duplicate the selected page.

Define and exercise these transitions:

| Event | Required result |
| --- | --- |
| Ordinary compact open | Menu, retaining current selection |
| Select a section | Detail for the selected route; focus its heading |
| Open a visible search result | Correct page/subpage/field and compact detail |
| Back from compact detail | Menu; focus the selected navigation item |
| Open a hidden target | Useful menu/unavailable state; no editable hidden control |
| Resize between compact and split layout | Same selected page and profile; predictable presentation |
| Browser history navigation | URL and rendered destination agree |
| Close | Existing modal close semantics and focus restoration; mounted chat retained |

Preserve unrelated query parameters, hash state, and existing moved-tab
redirects. Update multiple destination parameters in one navigation operation
where needed to avoid stale-query overwrites.

### 8.2 Layout and density

Start with the existing shared tokens and components described in
[UI styles](ui-styles.md). Introduce shared primitives only where settings and
another existing consumer use the same behavior:

- Navigation row: icon slot, label, active styling, disclosure, and touch density.
- Fullscreen containment: viewport size, safe areas, header/action slots, and
  scroll ownership.
- Header actions: accessible search, back, and close controls using the existing
  toolbar button implementation.

Keep layout breakpoints independent from touch density. Settings currently
collapses at 56rem, while the chat shell uses 48rem. Confirm that 56rem still
fits the intended two-column settings layout; document a deliberate difference
instead of changing it solely for consistency.

Shared primitives must expose their action placement explicitly. Stop positioning
close controls through upstream class names such as `pointer-events-none` once
the new containment owner is in use.

Use a shared label inset or grid column for header/navigation alignment. Avoid
recalculating the navigation label position with independent padding formulas.

Keep ordinary upstream form scrolling and nested picker behavior working. A
page should have one clear primary scrolling region, and the header/navigation
must remain usable while long content scrolls.

### 8.3 Focus and field visibility

Choose one existing focus owner for the fullscreen surface. Preserve nested
dialogs and portaled pickers; do not install a second conflicting focus trap.
Back/detail focus transitions belong to navigation, while close focus restoration
belongs to the modal boundary.

Replace DOM hiding with catalog decisions before controls render. Keep the
current observer only as a temporary fallback while any custom control still
depends on it. Its removal requires evidence that generic fields, Appearance
controls, custom controls, and direct-link destinations all consume catalog
visibility.

Hiding content visually is not permission enforcement and does not imply that
effects or requests stopped running. Avoid mounting an unavailable editable page
solely to hide it with CSS. Preserve page mounting when it is needed to protect
an active edit; establish its lifecycle explicitly rather than changing it for
cosmetic reasons.

## 9. Configuration actions

Make the local Configuration page consume commands instead of receiving the
former upstream footer JSX. Keep its route ID `config:browser-configuration`.

### Export

- Capture the target profile/connection when the action starts.
- Read through the existing upstream configuration helper for that target.
- Preserve the current JSON format and download behavior.
- Describe the file as the captured profile's configuration, not a complete
  backup of every profile or the instance.
- Inspect actual endpoint serialization before making categorical claims about
  credential inclusion/exclusion. Do not change export contents merely to match
  existing explanatory copy.
- Hidden presentation fields remain part of configuration according to existing
  endpoint semantics.

### Import

- Capture the destination before the picker opens. If it changes while the
  picker is open, keep the captured destination clear or cancel with useful
  feedback; do not silently retarget the file.
- Preserve invalid-JSON handling and the current import format.
- Reuse the upstream sparse-write, diff, and cache ownership behavior.
- Missing hidden keys must not be interpreted as instructions to delete them.
- Preserve existing validation and error feedback. Do not add an unrelated
  import preview or a new configuration replacement format.

### Reset

- Capture the target before confirmation and show that target in the confirmation.
- Cancel produces no write.
- Confirm applies existing defaults to the captured target through upstream APIs.
- Describe the reset accurately: it may change configuration fields hidden by
  presentation rules, and is scoped to the target rather than the whole instance.

### Save sequencing

Configuration actions must not race an outstanding autosave into restoring
pre-reset values or saving an imported file to a newly selected profile.

Map the upstream autosave queue and cache invalidation first. Use its existing
sequencing/flush behavior if exposed. If a small adapter hook is necessary,
expose the existing owner; do not create another writable configuration snapshot
or a parallel queue.

Until sequencing is proved, leave the affected commands behind the legacy
controller. Decoupling the page layout is not justification for changing its
write semantics.

## 10. Delivery sequence

Each delivery is a small, reviewable change. Keep the renderer pin fixed through
the structural migration. Use `codex/` branches and PRs on origin, without
rewriting history. Follow existing authorization for implementation; merging and
deployment remain separate actions.

| Delivery | Depends on | Work | Completion evidence |
| --- | --- | --- | --- |
| 0. Baseline and feasibility | None | Fix stale browser-test titles; establish the working toolchain; inspect adapter exports and unknown-page handling | Current settings behavior is reproducible; adapter feasibility and retained seams are documented |
| 1. Catalog | 0 | Consolidate metadata; retain `policy.ts` facade; move navigation and search consumers | One catalog supplies titles/groups/aliases/visibility; unknown entries still work |
| 2. Capabilities and target identity | 1 | Classify existing hidden controls; add support evidence and scope projection; show read-only Configuration target | Browser limitations and unknown host support are distinct; profile semantics remain correct |
| 3. Navigation and UI primitives | 1 | Explicit compact presentation state; shared row/containment primitives; preserve selected route and focus | Phone, tablet, desktop, history, zoom, and keyboard flows remain usable |
| 4. Adapter pilot | 0, 1, 2 | Compose Models and Chat through the typed adapter; prove unknown-page fallback | Warm/cold loads, profile switching, saving, and unknown-page rendering preserve upstream behavior |
| 5. Page and action migration | 2, 3, 4 | Migrate remaining pages and typed Configuration commands incrementally | Existing forms, child routes, scoped commands, and save sequencing remain correct |
| 6. Compatibility retirement | 5 | Remove superseded transforms/observer; update registry and docs; perform a temporary upgrade rehearsal | Retired code has no callers; remaining seams are minimal and checked; upgrade behavior is explained |

Deliveries 1-3 provide useful improvements even if the complete adapter boundary
must wait. Do not hold those improvements hostage to replacing every upstream
integration point.

### Delivery 0 checklist

- Inspect local changes in both the active worktree and the source checkout;
  preserve unrelated work.
- Recheck renderer preparation and dependency installation in the actual
  implementation checkout. Previous preview limitations are not evidence that
  the code compiled.
- Update browser expectations for Keyboard Shortcuts, AI Connections, Browser
  Automation, Saved Logins, Server Connection, Archived Chats, and Server
  Credentials, including search contexts and subnavigation labels.
- Keep one independent assertion of the requested visible taxonomy. Use stable
  destination IDs for unrelated behavioral tests where appropriate.
- Record current loading, search, scope, confirmation, focus, and draft behavior.
- Inspect the private upstream catalog/controller boundary before selecting a
  composition strategy.

### Delivery 1 checklist

- Introduce descriptor types and authored overrides without copying the schema.
- Move group order, titles, aliases, and scope copy into the catalog.
- Preserve the public policy functions until their consumers are migrated.
- Route page, palette, and field-search metadata through the resolved catalog.
- Preserve unknown-page and unknown-field fallback.

### Delivery 2 checklist

- Inventory each currently hidden field/custom control and its bridge/API owner.
- Record supported, unsupported, or unknown with evidence rather than name-based
  classification.
- Keep browser permission state separate from implementation support.
- Resolve configuration target identity from upstream stores.
- Add read-only target copy to Configuration without a picker.
- Verify default and non-default profile argument semantics.

### Delivery 3 checklist

- Define compact transition behavior before replacing existing flags.
- Keep URL selection and transient menu/detail state separate.
- Share navigation geometry and fullscreen action placement where practical.
- Retain search placement, title rules, active styling, and touch density.
- Reuse the established focus owner and preserve nested overlays.

### Delivery 4 checklist

- Implement the smallest viable upstream adapter using proven exports/seams.
- Preserve cache, profile, and remount ownership for Models and Chat.
- Pass existing callbacks such as model-change and configuration-save callbacks.
- Prove that unknown metadata has an actual content renderer/fallback.
- Keep legacy routes and page fallback until parity is demonstrated.

### Delivery 5 checklist

- Migrate pages in the order in section 7.4, with sensitive pages in separate
  commits where useful.
- Move Configuration commands out of footer-JSX transport.
- Coordinate actions with the existing save owner and capture their targets.
- Preserve schema validation, errors, retry, consent, and subpage navigation.
- Keep generic and custom-control visibility aligned with search.

### Delivery 6 checklist

- Remove unused source transformations and their registry entries individually.
- Remove the observer only after all relevant render paths consume visibility.
- Regenerate the inventory from the edited registry; never accept new source
  fingerprints without inspecting the upstream change.
- Remove the policy facade only after checking imports and callers.
- Update README customization guidance and UI ownership documentation.
- Rehearse new schema/page entries using fixtures. Use a temporary renderer pin
  change only if a suitable revision is available; restore the structural-work
  pin before finalizing that delivery unless an upgrade was separately requested.
- Keep remaining compatibility hooks and explain why each is retained.

## 11. Verification strategy

For implementation deliveries, run the repository's normal typecheck/build and
manually try the affected workflow. Use focused existing tests for meaningful
risks; a full suite, staged publication system, physical-device acceptance, or
release evidence package is not required by this plan.

```sh
pnpm prepare:renderer
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

Do not run Nix builds on the VPS. Do not change dependency versions or the
renderer pin merely to bypass a broken local setup. Renderer preparation must
not overwrite mismatched or modified fetched sources.

When catalog/adapter behavior changes, the existing focused script is useful:

```sh
node --test scripts/browser.test.mjs
```

When compatibility entries change:

```sh
pnpm docs:compatibility
pnpm check:compatibility-registry
pnpm check:upstream
```

With the documented synthetic preview environment running, focused UI checks
can use existing scenarios:

```sh
pnpm exec playwright test tests/browser/browser.spec.mjs \
  --project=chromium \
  --grep 'settings groups and renamed search|model and chat settings load|configuration page retains'
```

See [browser preview](browser-preview.md) for environment setup. Use real
browser interactions and observed requests to test behavior. Do not add tests
that only repeat descriptor values or stylesheet declarations.

### Focused acceptance matrix

| Risk | Evidence to obtain |
| --- | --- |
| New upstream entry disappears | Fixture adds a new schema field and an unknown page with content; both are discoverable and usable without local metadata |
| Hidden controls remain searchable/editable | Generic and custom hidden controls are absent from relevant search/render paths; old links produce useful fallback |
| Renaming breaks destinations | New titles and old aliases navigate to the same page/subpage/field |
| Warm-cache initialization fails | Models and Chat load after other pages warmed the cache, after reopen, and after switching scopes |
| Profile targeting changes | Inspect GET/PUT request scope for default/non-default profiles and delayed confirmations/pickers |
| Saves overwrite newer state | Hold a pending autosave while importing/resetting; later completion cannot restore stale state or retarget another profile |
| Export scope is overstated | Inspect downloaded JSON against the captured endpoint result; copy describes its actual scope |
| Unknown host capability is misclassified | Optional server capability metadata omitted; relevant remote settings remain appropriately explained rather than assumed unsupported |
| Modal damages active work | Open/close and resize settings with a draft and attachment; selection and content remain intact; recording stays under its existing owner |
| Focus/containment regresses | Back restores the active menu item; close restores its opener; nested picker remains usable; no unreachable close/search control |

Use representative viewport widths of 390, 820, and 1440 pixels. Check both
sides of the retained settings breakpoint and representative 100%/150% app
scale. Include one short landscape touch viewport. Broaden checks only when a
failure, new change, or unresolved concern justifies doing so.

No real server capability or account availability should be reported as verified
unless an authenticated, explicitly scoped observation established it. Synthetic
fixtures prove UI behavior, not the installed services on a particular host.

## 12. Compatibility cleanup and documentation

Track removal of these existing settings interventions:

- `useBrowserSettingsPresentation`: retire once the wrapper root owns composition
  through the complete adapter contract.
- `useBrowserConfigurationSettings`: retire once Configuration no longer needs
  props/control injection into the upstream form.
- `filterBrowserSettingsFields`: shrink or retain one render seam until all
  schema-field visibility flows through the catalog.
- `filterBrowserSettingsSearch` and `filterBrowserSettingsPalette`: replace
  presentation rewrites with the catalog projection; retain only necessary
  upstream search registration seams.
- `hideBrowserAppearanceOnlySettings` and `hideBrowserLocalProjectDirectory`:
  replace only when their handwritten controls use a checked visibility boundary.
- The frame's field MutationObserver: remove after generic/custom render coverage
  makes it redundant.

The shared `respectBrowserProfileSwitches` compatibility fix affects upstream
consumers beyond settings. Do not remove it merely because the settings root has
changed. Retain it until the pinned upstream lifecycle no longer needs it and
the initialization/profile-switch behavior is demonstrated.

Likewise, do not retire authentication recovery transforms as a side effect of
settings cleanup. Their ownership and verification are independent.

Update the customization instructions to explain:

- Which descriptors users edit to rename, reorder, group, or hide entries.
- How confirmed browser limitations differ from presentation preferences.
- How unknown upstream pages and fields are inherited.
- How server/profile scope is communicated.
- Which checked adapter seams remain during renderer updates.
- That automatic renderer activation remains parked.

## 13. Risks, stop conditions, and rollback

| Risk | Control and stop condition |
| --- | --- |
| Adapter copies upstream business logic | Keep form/save owners upstream; stop and retain the legacy adapter if extraction requires a parallel store or rewritten forms |
| Unknown pages get labels but no content | Do not remove the upstream fallback until the unknown-page content fixture works |
| Default/profile scope semantics change | Stop page/action migration on a mismatched request target; fix the adapter mapping before proceeding |
| Configuration commands race pending writes | Keep legacy command ownership until sequencing is proved; do not introduce a second queue |
| Source checks are weakened to finish migration | Preserve reviewed fingerprints; inspect changed contracts instead of blindly updating hashes |
| Responsive changes disrupt the chat | Keep chat mounted; revert the isolated UI delivery if draft, attachment, recording, or selection behavior changes |
| Capability rules hide valid remote settings | Use evidence-based unknown support and explicit scope; test absence of optional server metadata |
| Refactor expands into release/platform rebuild | Keep the current framework, bridge, image workflow, and safe-update system |

Use ordinary revert commits for an isolated failed delivery. Do not reset
browser storage, profile configuration, credentials, or server data to recover.
If a separately authorized deployed change breaks behavior, use the previous
immutable image digest through the existing rollback procedure.

## 14. Completion checklist

- [ ] Current product contract preserved across phone, tablet, and desktop.
- [ ] One resolved catalog drives navigation, titles, aliases, search, scope
  explanations, and visibility decisions.
- [ ] Server schema and upstream stores remain authoritative; no parallel
  mutable configuration/conversation store introduced.
- [ ] Known and unknown upstream entries have functioning content paths.
- [ ] Browser limitations, permission state, unknown server support, and owner
  curation are represented distinctly.
- [ ] Configuration identifies its target without a profile picker and preserves
  scoped export/import/reset behavior and write sequencing.
- [ ] Models/Chat initialization, child routes, error/retry behavior, focus, and
  active-work preservation are demonstrated.
- [ ] Shared UI geometry replaces duplicated row/header placement where useful.
- [ ] Superseded transformations/observer removed; retained seams documented and
  fingerprinted.
- [ ] Stale test expectations corrected; relevant typecheck/build and focused
  checks recorded, including any checks that could not complete.
- [ ] Customization and upgrade documentation reflects actual behavior.
- [ ] Renderer automation, repository settings, and production deployment left
  under their existing authorization and workflow.

## 15. Handoff record for each implementation delivery

Record a short note in the PR or handoff message with:

1. Delivery number, base revision, and unchanged renderer pin.
2. Actual files and ownership boundaries changed.
3. Preserved legacy fallback or compatibility seams.
4. Checks performed and their results; distinguish fixture checks from live-host
   observations.
5. Any blocked check or unresolved behavior and the smallest next action.
6. Whether that delivery's completion evidence is satisfied.

Do not mark the entire plan complete because one shell migration or a merged PR
exists. Completion means the checklist above describes the actual implementation.
