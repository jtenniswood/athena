# Hermes Desktop in the browser

This workspace composes the upstream Hermes Desktop renderer with browser
services. Upstream files are fetched at the exact revision in the root
`flake.lock`; they are never edited here.

See the root [README](../../README.md) for setup and hosting commands.

## Ownership

- `src/platform`: browser transport, authentication, attachments, clipboard,
  notifications, runtime configuration, and display preferences.
- `src/upstream`: renderer imports, desktop bridge assembly, checked transforms,
  and module overrides.
- `src/overrides`: browser components using upstream visual primitives.
- `src/web-bridge`: stable bridge installation and connection compatibility.
- `vite.config.ts`: build composition and the single-gateway development server.

## Settings customization

The browser settings layout and its hide/order policy live in
`src/experience/settings/`. Edit `settings/policy.ts` to customize the
presentation without changing stored configuration values or upstream files.
Unlisted sections and fields inherit upstream visibility and order.

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
`src/upstream/browser-plugin.ts` and are fingerprinted in the compatibility
registry. Review those contracts when updating Hermes Desktop.

Docker and development serve `runtime-config.js` with no caching. Browser
requests stay on the app origin and the server forwards them to its one
configured gateway. Profiles and Bots still share that gateway.

Notifications require browser permission and a supported secure context.
They are page/service-worker notifications, not server push subscriptions.
Native terminal, native git, desktop overlays, and desktop updating are not
browser capabilities. File attachments use browser File/Blob handles.
