<h1 align="center">
  <img src="apps/web-desktop/public/athena.svg" alt="Athena A icon" width="128">
</h1>

Athena is a web app and installable PWA for Hermes Agent, with a Docker image
for self-hosting. The pinned Hermes Desktop renderer is fetched from
[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) at
build time.

> This is intended for private networks such as Tailscale and is not hardened for the public internet.

## Docker self-hosting

The image contains Athena’s web UI, nginx, and a small settings storage service.
It connects to a separate, already-running Hermes Gateway. The quickest setup
uses the published Docker
image and `docker run`; Compose is optional. See the [Compose wiki guide](https://github.com/jtenniswood/athena/wiki/Run-with-Docker-Compose)
if you prefer Compose.

### 1. Create the environment file

Copy the template, then edit [`.env.hermes-web`](apps/web-desktop/.env.example) and set the gateway address:

For a gateway running on the same host as Docker, use:

```dotenv
HERMES_GATEWAY_URL=http://host.docker.internal:9119
HERMES_GATEWAY_NAME=Local Hermes
HERMES_HOME=/data/hermes
```

If the gateway is elsewhere, set `HERMES_GATEWAY_URL` to its reachable HTTP(S)
address, such as its Tailscale IP or MagicDNS hostname. Use the origin only;
do not add a path such as `/api`.

### 2. Start Athena

The command pulls the published image automatically. On Linux,
`--add-host` lets the container reach a gateway on the Docker host.

```bash
docker run -d \
  --name athena \
  --restart unless-stopped \
  --env-file .env.hermes-web \
  --add-host host.docker.internal:host-gateway \
  -p 4174:80 \
  -v athena-preferences:/data/athena \
  -v "$HOME/.hermes:/data/hermes:ro" \
  ghcr.io/jtenniswood/athena:latest
```

Open <http://localhost:4174/>. The mounted Hermes directory lets Athena serve
installed `plugins/` and `desktop-plugins/`; remove the Hermes directory mount
if you do not use filesystem plugins.

To stop Athena:

```bash
docker stop athena
```

For microphone access from another device, open Athena over HTTPS (for example,
through Tailscale Serve).

### Container logs

Follow startup and request diagnostics with:

```bash
docker logs --follow athena
```

Startup JSON lines report the build revisions, release channel, listening
address, gateway origin, sign-in mode, and plugin directory availability.
Request JSON lines include a route category, HTTP status, response size, total
request time, and gateway status and response time (in seconds). WebSocket
requests are logged when the connection closes. Access logs omit full URLs,
query strings, cookies, and authorization headers. nginx errors also go to
Docker logs using nginx's native format and may include request URLs; redact
these before sharing logs. Athena's container logs cover the UI server and
proxy; check the separate Hermes Gateway logs for agent execution details.

### Settings sync

Athena saves your appearance, user preferences, and sidebar layout to the server
and loads them when you open Athena on another device using the same account.
The first device imports its existing preferences. Changes to different settings
merge; when two devices change the same setting, the last server save wins.

Open **Settings → Configuration → Sync across devices** to see the save status.
An already-open device checks for changes when you return to it and periodically
while visible. Select **Apply changes** to load settings saved on another device;
Athena checks drafts, recordings, attachments, and pending work before reloading.
Offline edits remain saved locally and retry when the connection returns.

Keep the writable `athena-preferences:/data/athena` volume when recreating or
upgrading the container. `HERMES_PREFERENCES_DIR` can change the storage location.
Hermes verifies the account on every request; token-only connections share the
gateway's local account. Backend profile configuration continues to be saved by
Hermes. Drafts, credentials, browser permissions, transcript caches, and the
currently selected conversation stay local.

### Browser notifications

Open **Settings → Notifications → Allow browser notifications**, then accept
the browser prompt. Keep **Enable notifications** and **Response ready** on to
receive an alert when a reply finishes in your current chat while Athena is in
the background. Use **Send test notification** to check delivery. Clicking a
response notification returns to its conversation.

Notifications require HTTPS or localhost. On iPhone and iPad, add Athena to the
Home Screen and open the installed app. Keep Athena open: alerts pause if the
browser suspends or closes it. If permission is blocked, allow notifications
in the browser’s site settings.

### Android app

`apps/android` contains a native Android shell for the hosted Athena web app.
Enter your Athena HTTPS address when the app opens. The web interface and its
updates continue to come from that server. Android supplies notifications,
file selection, microphone permission, and back navigation. External links open
in the browser. App settings can change the server or reload after Athena has
confirmed that drafts are saved and recordings and active replies have finished.
On supported APKs, open **Navigation tabs → App settings** for these Android
controls. The separate Android header is hidden once that menu is ready and
returns during page loading or sign-in. Older APKs and older server versions
retain their native App settings button.

On supported APKs, the chat model menu uses a native searchable sheet. Tap a
model to select it; tap its arrow or long-press for favorites and model options.
Search retains Hermes model matching and large catalogs remain available across
pages. Browsers and older APKs retain the web menu.

The native setup, settings sheet, and confirmation dialogs use Material 3, follow
the system light/dark theme, and use wallpaper colours on Android 12 and later.
Server setup includes inline address validation and a keyboard Connect action.

Build with Java 17 and the Android SDK (platform 36 and build tools 35.0.0):

```bash
cd apps/android
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

The APK is `apps/android/app/build/outputs/apk/debug/app-debug.apk`. The Android
GitHub Actions workflow also builds a debug APK for review. Debug artifacts from
different machines or workflow runs can have different signing keys; use a
consistent release signing key for installations that must preserve drafts
across updates. Release signing reads `ATHENA_ANDROID_KEYSTORE`,
`ATHENA_ANDROID_STORE_PASSWORD`, `ATHENA_ANDROID_KEY_ALIAS` (default `athena`),
and `ATHENA_ANDROID_KEY_PASSWORD`. With these set, build `:app:assembleRelease`.
Keep the keystore and its passwords outside Git and retain a secure backup.

Hermes and OIDC sign-in use an Android Custom Tab. Check the matching code and
approve the handoff in the browser, then return to the app. The server transfers
the session through a one-use PKCE exchange lasting five minutes. This moves
the browser's Athena session into the app so rotating refresh tokens are not
shared between two clients. Session-token sign-in remains available.

Native alerts work without Firebase while the web app is running. To receive
response-completion and response-error alerts after Android suspends or closes
the app:

1. Create a Firebase project and register an Android app with package name
   `com.athena.android`. Analytics is not required.
2. Download `google-services.json` to `apps/android/app/google-services.json`
   before building the APK. The file is ignored by Git. Builds without it keep
   local notifications and omit Firebase initialization.
3. Enable Firebase Cloud Messaging's HTTP v1 API. Give a dedicated service
   account the **Firebase Cloud Messaging API Admin** role on that project,
   and mount its JSON credentials into the Athena container as a read-only secret.
4. Set `ATHENA_FIREBASE_CREDENTIALS` to the credentials' path inside the container,
   for example `/run/secrets/athena-firebase.json`. Recreate the container with
   an Athena version that includes Android support.
5. Sign into the app and allow Android notifications under **Settings →
   Notifications**. Existing notification toggles control delivery.

Restrict the Android API key to `com.athena.android` and the SHA-1 fingerprint
of your APK signing certificate. Debug, release, and Google Play signing keys
have different fingerprints; allow each certificate only when it needs Firebase
access. Limit the key's API allowlist to Firebase Installations, FCM Registration,
Firebase Management, and Cloud Logging. Remove unused client keys. Keep the
server credential private, outside Git and the APK, with file permissions `0600`;
the container only needs read access. This integration does not need a database,
Storage bucket, Analytics, or a billing account. If you add data services later,
configure their Security Rules before storing data.

Check the sender's credentials and permission without sending a notification:

```bash
ATHENA_FIREBASE_CREDENTIALS=.athena/firebase-service-account.json node scripts/check-android-push.mjs
```

For example, add the following environment variable and secret mount to your
Athena Compose service, using your own local credentials file:

```yaml
environment:
  ATHENA_FIREBASE_CREDENTIALS: /run/secrets/athena-firebase.json
volumes:
  - ./.athena/firebase-service-account.json:/run/secrets/athena-firebase.json:ro
```

The Android connection goes through a small server relay that forwards the same
Hermes protocol and retains the authenticated connection while its WebView is
away. It sends generic alerts through Firebase; response text and credentials
are not included in push payloads. Notification taps open the conversation.
Signing out disables native push and removes the server's device registration.

The relay keeps a disconnected active response for up to 24 hours and closes
idle disconnected sockets after a minute. Device bindings and a bounded delivery
queue are stored privately in the existing `/data/athena` volume; no conversation
history or response text is stored. Observed completion events survive a restart
and retry up to 12 times, expiring after one hour. Restarting the container still
interrupts the retained upstream connections: events that occur while disconnected
cannot be recovered until a supported server event source is available.

App settings shows token-registration and delivery-attempt status. “Accepted by
Firebase” does not prove Android displayed an alert. A short-lived acknowledgement
from a connected, visible conversation suppresses its foreground alerts; the
navigation list and other conversations still receive notifications. Token rotation
uses a credential restricted to updating that installation's token, with retry on
app resume when connectivity or Cloudflare Access is unavailable. Sign-out revokes
the binding; changing servers also discards its native refresh credential.

Force-stopping the
app, disabling notifications, or Android battery restrictions can prevent or
delay alerts. Background approvals and plugin alerts still depend on the
running web app; background push currently covers response completion and errors.

Signed APK releases include checksums and build metadata; see [Android releases](docs/android/releases.md).

### Sign in

Athena checks the configured Hermes server before opening chat. If authentication
is required, its welcome screen offers **Sign in** and connects automatically
after Hermes creates a session. Existing sessions go straight to chat. On mobile
and installed PWAs, sign-in uses the current window and returns to the original
conversation; desktop browsers also offer a sign-in popup. **Use a session token**
is available for existing token-based setups.

Choose the sign-in flow in Athena's Docker environment file or with `docker run
-e HERMES_AUTH_MODE=oidc`. Recreate the container after changing it; the same
image supports all three values:

| `HERMES_AUTH_MODE` | Sign-in flow |
| --- | --- |
| `auto` (default) | Detect the gateway's providers; use its chooser when several are available. |
| `hermes` | Open the Hermes Agent login page for its configured account authentication. |
| `oidc` | Open the gateway's self-hosted OIDC provider directly. |

This also selects the browser sign-in flow in **Server Connection** settings. Existing
sessions and session-token connections continue to work. Hermes verifies
credentials and decides which authentication methods are accepted; this setting
does not disable backend authentication. For `oidc`, configure the OIDC provider
on the Hermes backend as described below.

To sign out, open the settings menu and select **Sign out**. Athena saves your
text drafts and returns to the sign-in screen. Finish active responses or
recordings, and send or remove unsent attachments, before signing out.

Authentication is configured on the **Hermes backend**, separately from Athena's
container. For OIDC, register a public client with authorization code and PKCE
(S256), and allow `https://athena.example.com/auth/callback` as its redirect URI.
Set these values in the backend's environment, using your own URLs and client ID:

```dotenv
HERMES_DASHBOARD_OIDC_ISSUER=https://auth.example.com/application/o/hermes/
HERMES_DASHBOARD_OIDC_CLIENT_ID=hermes-dashboard
HERMES_DASHBOARD_PUBLIC_URL=https://athena.example.com
```

Use Athena's browser-facing HTTPS URL as `HERMES_DASHBOARD_PUBLIC_URL`. Keep
`/login`, `/auth`, and `/api` on that same origin; Athena's bundled nginx already
proxies these routes. If another proxy terminates TLS, configure Hermes's trusted
proxies so HTTPS redirects and secure cookies work. Hermes handles provider
selection, credentials, OIDC callbacks, and session refresh. See the
[Hermes authentication guide](https://github.com/NousResearch/hermes-agent/blob/f97608f178d1ffeca59860195ab7da295f7c8e5f/website/docs/user-guide/features/web-dashboard.md#self-hosted-oidc-provider)
for provider and proxy configuration. OIDC controls access to the connected
Hermes instance; it does not create separate user workspaces.

For step-by-step client registration, backend settings, Docker configuration,
and troubleshooting, see [Set up OIDC in the wiki](https://github.com/jtenniswood/athena/wiki/Set-up-OIDC).

### New sessions in All profiles

New sessions in **All profiles** use the first enabled profile in the profile
rail's saved order. Profiles hidden through **Profile actions** are skipped;
reordering the rail changes which profile is used first. When viewing a single
profile, new sessions use that profile; starting a session explicitly for a
profile keeps that choice.

### Development

See the [tooling index](docs/tooling.md) for the local development loop, focused
checks, and the distinction between active workflows and historical scripts.
The [release guide](docs/releases.md) describes publication and rollback.

### Acknowledgment

Athena is an original project based on the work of
[hermes-desktop-web-mobile-pwa](https://github.com/mdg-qc/hermes-desktop-web-mobile-pwa),
with extensive improvements for web and mobile.

### Android with Cloudflare Access and Pocket ID

If Cloudflare Access asks you to sign in before Athena loads, use **App settings →
Sign in through Cloudflare Access**. Athena also offers this flow when it detects
an Access login redirect. The app opens your browser, where Pocket ID can use its
normal passkey prompt. Check the server address and matching code, approve the
connection, then tap **Return to Athena Android**. Athena imports the Access
application cookie into its WebView and reloads after checking draft safety.

Keep `/api/athena/android/auth/access` behind the same Cloudflare Access policy
as Athena. No Access bypass rule, client secret, or shared service token is
needed. Both the Android APK and Athena server must include this integration.
The handoff is encrypted for a short-lived key held by the requesting app;
Pocket ID cookies and passkeys are never transferred. Your browser remains
signed into Access. Repeat the flow when the Access session expires, or if you
change servers. Athena's own sign-in may still be required after Access succeeds.

The tunnel must preserve the HTTPS public hostname and the `CF_Authorization`
cookie on requests to Athena. This does not add a general browser-cookie import
or change your Cloudflare policies. Test the flow with your actual Access policy
and Android browser before relying on it away from your server.
