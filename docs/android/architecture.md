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

## Completion-event source assessment

This assessment inspected Hermes revision
`f0d94882e89ab8d4098b5bb2f166adfb9ee0a0ab`, pinned in Athena's `flake.lock`.
The supported interfaces found do not provide a durable, account-scoped global
completion feed that can replace Athena's retained authenticated transport.

- The [OpenRPC contract](https://github.com/NousResearch/hermes-agent/blob/f0d94882e89ab8d4098b5bb2f166adfb9ee0a0ab/apps/shared/src/gateway-contract.openrpc.json)
  exposes `session.events.since` and `session.events.stats`. The
  [implementation](https://github.com/NousResearch/hermes-agent/blob/f0d94882e89ab8d4098b5bb2f166adfb9ee0a0ab/tui_gateway/methods_session.py)
  reads an in-process replay ring, with sequence/epoch and truncation semantics.
- [Replay storage](https://github.com/NousResearch/hermes-agent/blob/f0d94882e89ab8d4098b5bb2f166adfb9ee0a0ab/tui_gateway/event_replay.py)
  is bounded in memory and freed when a session is torn down. It helps reconnecting
  viewers; it cannot promise completion recovery after a gateway restart.
- [SessionEvents observers](https://github.com/NousResearch/hermes-agent/blob/f0d94882e89ab8d4098b5bb2f166adfb9ee0a0ab/gateway/session_events.py)
  are authority-local Python recipients, rather than an externally authenticated,
  durable service subscription.
- The [agent:end hook](https://github.com/NousResearch/hermes-agent/blob/f0d94882e89ab8d4098b5bb2f166adfb9ee0a0ab/gateway/hooks.py)
  and its [post-turn invocation](https://github.com/NousResearch/hermes-agent/blob/f0d94882e89ab8d4098b5bb2f166adfb9ee0a0ab/gateway/run_turn_persistence.py)
  are useful extension points. Their documented context includes response content,
  but does not establish an account-scoped delivery cursor, replay/acknowledgement
  contract or universal correlation with every desktop completion event.

Revalidated against the pinned source on 2026-11-03. The current
`SessionEvents` implementation adds authority-private replay keys, lifecycle
epochs and explicit replay-gap handling, but still stores replay in the same
bounded process memory. Its Python observers remain synchronous, local recipients.
Neither the replay API nor the post-turn hook supplies a durable external
account subscription that survives a gateway restart.

The implemented decision is to retain the authenticated relay and persist events
once observed. Do not read private Hermes database tables, retain broad account
cookies for an unattended collector, or forward raw hook context to Firebase.
Those choices would weaken the current authentication and privacy boundary.

A replacement feed needs stable completion identifiers, account/profile/session
ownership, durable cursors, expiry, revocation and replay-gap handling. Once a
supported upstream interface supplies those properties, it can feed the existing
outbox without replacing the Android client or creating another chat store.
Current limits remain explicit: the queue survives Athena restarts, but an event
never observed while the transport is down cannot be reconstructed from it.

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
