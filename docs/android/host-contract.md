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

## Implementation sequence

1. Connection coordinator, capability handshake, guarded settings handover,
   navigation correlation and diagnostics.
2. Persistent notification registrations and delivery attempts, explicit web
   visibility acknowledgement, and token-rotation recovery.
3. Reproducible signed APK releases and real-emulator compatibility tests covering
   native, web bridge and authentication changes; verify data-preserving upgrades.
4. Investigate a supported Hermes completion event source independent of the
   WebView. Persisting an outbox alone cannot recover events never observed.
5. Continue Material 3 native setup/settings improvements incrementally. Evaluate
   Compose for new native controls while preserving the existing complex WebView
   host until interoperability and lifecycle behaviour are proven.

Implementation and verification of later steps are tracked in the related PRs;
this document defines the ownership and compatibility boundaries, not a claim
that every step has shipped.

## Targeted verification

Run `./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug` from
`apps/android`. With a running emulator, add `:app:connectedDebugAndroidTest`.
The instrumentation fixture uses HTTPS-origin web content in the real WebView,
including the production origin checks and native bridge. It verifies settings
handover and navigation approval correlation; it does not emulate Google or
Pocket ID account approval. The existing browser authentication tests cover the
server approval forms and security boundaries separately.

The Android workflow runs the instrumentation test on API 35 and also responds
to changes in the shared bridge, settings integration, authentication adapters,
and nginx routes. Signed release distribution and full sign-in/upgrade checks
are separate subsequent work, not implied by the bridge fixture.
