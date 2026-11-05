# Athena for Hermes Agent

This workspace customises the official Hermes Webapp. Its released browser
host owns transport, sign-in, files and shared renderer preferences. Athena
adds its interface, safe PWA lifecycle and small browser/Android extensions.
Upstream sources are fetched at the release revision in `flake.lock` and remain
read-only. The runtime image is pinned alongside them in `hermes-release.json`.

See the root [README](../../README.md) for setup and hosting commands.
See the [tooling index](../../docs/tooling.md) for development and diagnostics.

## Ownership

- `src/platform`: browser lifecycle, notifications, runtime configuration and
  Athena preference ownership.
- `src/upstream`: renderer imports, official host integration, checked UI
  transforms and module overrides.
- `src/overrides`: browser components using upstream visual primitives.
- `src/web-bridge`: compatibility for the isolated synthetic preview host.
- `vite.config.ts`: build composition and the single-gateway development server.

## Settings customization

The browser settings layout and its hide/order policy live in
`src/experience/settings/`. Edit `settings/policy.ts` to customize the
presentation without changing stored configuration values or upstream files.
Unlisted sections and fields inherit upstream visibility and order.
Import, export, and reset are under **Settings → Configuration**. This local
page uses the `config:browser-configuration` section id and retains upstream
file handling, profile scoping, and reset confirmation.

Examples:

```ts
sections: {
  hidden: ['voice'],             // hide a config section on every screen size
  order: ['config:appearance']   // move Appearance ahead of unspecified pages
},
fields: {
  hidden: ['display.show_reasoning', 'appearance.theme']
}
```

Section rules accept a config id such as `voice`, a page id such as
`config:voice`, or a non-config page id such as `keybinds`. Config field rules
use the canonical schema key; built-in Appearance rows use stable ids such as
`appearance.theme`. Hiding a field only removes it from the page and settings
search. It does not clear its saved value. New upstream entries remain visible
unless you add an explicit rule. UI sections and fields unavailable in the
browser remain unavailable regardless of these presentation preferences.

The renderer is pinned in the root `flake.lock`. New upstream UI is incorporated
when that pin is upgraded and reviewed; it does not update in place at runtime.
The checked settings composition and visibility adapters live in
`build/renderer/browser-plugin.ts` and are fingerprinted in the compatibility
registry. Review those contracts when updating the pinned renderer.

For local development, start an official Webapp with cookie-based sign-in, then
run `pnpm dev` (the default target is `http://127.0.0.1:9120`). Override
`HERMES_GATEWAY_URL` when needed. Development supplies credential-free browser
bootstrap flags; the existing
development proxy forwards API and login routes. The served Docker bundle uses
the official server's full bootstrap. Raw Vite preview retains the synthetic
host for existing fixture checks. `ATHENA_OFFICIAL_WEBAPP=0` explicitly selects
that synthetic host during Vite development.

Notifications require browser permission and a supported secure context.
They are page/service-worker notifications, not server push subscriptions.
The official host supplies supported browser file and terminal capabilities.
Desktop overlays and desktop updating remain unavailable in the browser.
