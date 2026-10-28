# Android host contract

The Android host owns connection progress, system insets, browser handoffs,
permissions and native settings. The shared web interface owns conversations,
drafts, recordings and chat navigation. Server-side adapters own authentication
exchanges and notification delivery. Keep these together in this repository;
do not duplicate the upstream conversation store in Kotlin.

## Bridge version 1

Messages use `{ id, protocol: 1, method, payload }`. Responses contain either
`{ id, value }` or `{ id, error: { code, message } }`. Missing protocol is accepted
for older web clients. Unsupported protocol versions and methods produce errors.
Only the selected HTTPS origin's main frame may call the bridge.

`hello({ protocol: 1 })` returns the protocol, APK version, capability names,
`insets: "native"`, and `typography: "platform"`. New clients must inspect the
capabilities before using optional methods. Old APKs may respond `false`; keep
legacy behaviour available without assuming a new capability.

`appSettingsMenu({ mounted, rendered })` hides the native toolbar only after a
successful handshake and the web menu has rendered its App settings entry.
Discovery alone must never hide native controls. Unmounting, page navigation,
or recovery restores the native toolbar. Old web clients keep the native toolbar.

`webState({ ready, revision, serverProtocol })` reports completion or failure of
web startup. Native recovery must stay available when JavaScript fails to start.
The server capability endpoint is `GET /api/athena/android/capabilities`; it
returns protocol and supported server adapters without credentials or user data.
Cloudflare Access still protects it. A missing endpoint does not prevent ordinary
web chat; diagnostics show compatibility as unavailable.

Native destructive navigation emits a cancellable
`athena:prepare-native-navigation` CustomEvent with `detail.requestId`.
`navigationReady({ requestId, ready, reason })` must echo the ID after saving
pending drafts. Unmatched or late approvals cannot authorize a different action.
Reloads, server changes and notification taps use this guard. A page that has not
loaded a composer can allow reconnect without claiming that an active draft is
safe. A mounted old web client without request-ID support blocks the operation
and asks the user to update rather than risking draft loss.

## Connection lifecycle

`ConnectionCoordinator` describes setup, loading, Access sign-in, Athena sign-in,
ready and recovery. Authentication helpers retain their independent security
boundaries and report progress to that coordinator. Pending exchanges survive
Activity recreation in private, backup-excluded storage and expire after five
minutes. Cancellation and server changes invalidate pending exchanges; callbacks
from an older attempt must not affect a newer one. Never put cookies or tokens in
bridge diagnostics.

Connection status offers retry and App settings without destroying an active
WebView. App settings exposes APK version, bridge/server protocol, web revision,
WebView version, Firebase configuration and notification status. Failed or old
servers remain recoverable through native controls.

## Ownership and release boundaries

The connection coordinator, capability handshake, correlated navigation and safe
settings handover are implemented by the native host and shared web adapters.
Notifications use persistent registration/delivery state, explicit visibility
acknowledgements and scoped native token refresh. Signed APK releases and
compatibility metadata are described in [Android releases](releases.md).

The [architecture assessment](architecture.md) records the completed upstream
event-source and native UI framework investigations. The retained relay remains
necessary with the currently pinned Hermes interface; persistence cannot recover
completion events it never observed.

## Targeted verification

Run `./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug` from
`apps/android`. With a running emulator, add `:app:connectedDebugAndroidTest`.
The instrumentation fixture strips types from the actual production Android web adapter using Node.js 22.6+ (CI uses Node 26), then runs that module as HTTPS-origin web content in the real WebView,
including the production origin checks and native bridge. It verifies settings
handover and navigation approval correlation; it does not emulate Google or
Pocket ID account approval. The existing browser authentication tests cover the
server approval forms and security boundaries separately.

The Android workflow runs the instrumentation test on API 35 and also responds
to changes in the shared bridge, settings integration, authentication adapters,
and nginx routes. Signed release validation and data-preserving upgrade checks complement this
fixture. Live identity-provider account approval remains separate from the
local authentication protocol and lifecycle tests.

## Persistent notifications and token refresh

Production uses one private `android-push.json` file in `HERMES_PREFERENCES_DIR`.
The existing data volume must have a single writer. Atomic, synced replacements
preserve the previous in-memory state if a write fails. Device registrations expire
24 hours after their last authenticated web registration. The store is bounded to
500 devices and 5,000 events. Delivery attempts use capped exponential backoff,
stop after 12 attempts, and expire after an hour. Firebase acceptance is recorded
separately from Android display. No chat text, account cookies or refresh-key
plaintext is persisted by the server relay.

The web client retains an installation seed across page reloads; the server derives
an account-specific binding from it. The native host accepts only its current
server and binding. A scoped refresh key, hashed on the server, permits only FCM
token replacement for that binding through `POST /api/athena/android/push/token`.
It cannot register another device, change notification preferences, read account
data, or extend the authenticated registration lifetime. Cloudflare Access remains
in front of this endpoint. Missing or expired Access cookies require reopening
Athena; the native status explains that registration is pending.

`webVisibility({ sessionId })` acknowledges a connected, selected conversation.
The shell refreshes it every three seconds and clears it when hidden, disconnected,
in navigation or in settings. Native suppression additionally requires an active
Activity with window focus, a matching conversation and an acknowledgement no older than ten
seconds. Pause, lost window focus, native settings, navigation, recovery and process death invalidate it. Duplicate
and expired FCM events are filtered before display, including after dismissal.

`GET /api/athena/android/push?device=...` authenticates the account and exposes
registration, relay and delivery-attempt status without device credentials.
`pushDiagnostics({ status })` supplies that status to native App settings.
