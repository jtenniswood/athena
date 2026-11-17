# Android host architecture

Athena keeps one shared web chat engine. Android owns the connection and operating
system integration; it does not maintain another conversation or draft store.
The APK, web interface and server adapters stay in this repository because their
compatibility boundary needs joint review and testing.

| Component | Responsibility |
| --- | --- |
| `MainActivity` | WebView lifetime, origin checks, system permissions and guarded navigation |
| `ConnectionCoordinator` | Setup, authentication, loading, ready and recovery state |
| `NativeAuthentication` | Orchestrate separate Access and Athena browser handoffs |
| `NativeBridge` | Validate versioned message envelopes and produce structured errors |
| `LegacyNativePresentation` | Retained native menu/settings capabilities, dispatch and presenter lifetime for older web clients |
| `NativeAppSettings` | Material 3 settings and connection-details presentation |
| `AppDiagnostics` | Explicitly limited, credential-free status projection |
| `NativePushRegistration` | Rotate the current binding's FCM token using a scoped credential |
| `WebVisibility` | Expiring acknowledgement of the connected, visible conversation |
| Shared web shell | Authoritative chat selection, drafts, recordings and navigation safeguards |
| Shared Settings presentation | Committed rows and commands from existing web/renderer owners; current Android clients retain the web layout |
| Server adapters | Protected authentication exchanges, account/device bindings and durable delivery attempts |

Page navigation invalidates the document's bridge/menu handshake. A transient
session reconnect preserves that handshake while showing native recovery controls;
reconnection must not permanently reintroduce a duplicate native header. Browser
handoffs preserve their separate cookie and security boundaries. Closing a host
invalidates callbacks but retains an unexpired pending exchange for its replacement.

Native reloads, server changes and notification taps share the web draft/recording
guard. An approval carries its request ID so a late response cannot authorize a
new action. Connection details exposes only selected status fields; copying it
must not copy cookies, FCM tokens, refresh credentials or chat content.

The retained `NativeSettingsPage` presenter supports older web clients and isolated
contract tests. The current web entry point does not install it. Explicit Settings
descriptors can feed that presenter without scraping wrapper controls, while a
guarded compatibility adapter remains for complex upstream controls. Both paths
keep validation and pending saves with the original web owners.

`LegacyNativePresentation` owns both retained presenters and their six bridge
methods. Its capability list remains part of protocol 1. The Activity delegates
presentation dispatch and lifecycle events to that owner; origin validation,
native file selection, authentication, OS permissions, recovery and App settings
remain host responsibilities. New presentation features use the shared web UI.

These capabilities remain supported for older web clients. No version cutoff is
assumed: APK and server updates are independent. Future retirement can remove
individual presenter capabilities after the supported client combinations have
an equivalent web path, while retaining native connection and recovery controls.

## Completion-event source assessment

This assessment inspected Hermes v0.23.0 at the renderer revision in
`hermes-release.json` and `flake.lock`.
The supported interfaces found do not provide a durable, account-scoped global
completion feed that can replace Athena's retained authenticated transport.

- The [OpenRPC contract](https://github.com/NousResearch/hermes-agent/blob/2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19/apps/shared/src/gateway-contract.openrpc.json)
  exposes `session.events.since` and `session.events.stats`. The
  [implementation](https://github.com/NousResearch/hermes-agent/blob/2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19/tui_gateway/methods_session.py)
  reads an in-process replay ring, with sequence/epoch and truncation semantics.
- [Replay storage](https://github.com/NousResearch/hermes-agent/blob/2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19/tui_gateway/event_replay.py)
  is bounded in memory and freed when a session is torn down. It helps reconnecting
  viewers; it cannot promise completion recovery after a gateway restart.
- [SessionEvents observers](https://github.com/NousResearch/hermes-agent/blob/2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19/gateway/session_events.py)
  are authority-local Python recipients, rather than an externally authenticated,
  durable service subscription.
- The [agent:end hook](https://github.com/NousResearch/hermes-agent/blob/2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19/gateway/hooks.py)
  and its [post-turn invocation](https://github.com/NousResearch/hermes-agent/blob/2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19/gateway/run_turn_persistence.py)
  are useful extension points. Their documented context includes response content,
  but does not establish an account-scoped delivery cursor, replay/acknowledgement
  contract or universal correlation with every desktop completion event.

Athena combines the authenticated relay with a scan of recent saved replies and
scheduled reports. Its queue survives server restarts. The scan uses an
in-memory authenticated watch, so discovery resumes after the app renews its
registration. Renewed registration can recover replies within the scan window.
The [push tests](../../scripts/android-push.test.mjs) exercise this boundary
with a saved reply and a scheduled report that share a chat ID across profiles,
then check that sign-out stops delivery.

A replacement feed needs stable completion identifiers, account/profile/session
ownership, durable cursors, expiry, revocation, and replay-gap handling.
Evaluate it alongside the current sources with delivery disabled until it
handles restart, duplicate IDs across profiles, scheduled reports, and
sign-out. Its authorization should be scoped to this feed so registering a
device does not give the delivery service general access to the account.

## Native UI framework assessment

Keep Material 3 Views for the existing host and its native setup/settings surfaces.
Settings and diagnostics now have their own presentation component, and browser
sign-in dialogs use the same Material design system. System fonts and insets remain
owned by Android, with the web interface opting into its host-specific styling.

Compose is a reasonable choice for a future substantial native feature. It is not
necessary to add a second UI framework for the current small settings surface.
Android's [WebView interoperability guidance](https://developer.android.com/develop/ui/compose/migrate/interoperability-apis/wrap-webview-in-compose)
explicitly cautions against prematurely migrating complex WebView integrations.
The [current Compose setup guidance](https://developer.android.com/develop/ui/compose/setup-compose-dependencies-and-compiler)
also notes newer Compose dependencies can require a newer compile SDK and Android
Gradle plugin; this host currently uses SDK 36 and AGP 8.13.2.

The migration boundary is therefore established without recreating the active
WebView: replace individual native presentation components if a future feature
justifies Compose, while preserving the connection coordinator, bridge protocol,
authentication helpers, permissions and web-owned draft/recording state.
