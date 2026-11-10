<h1 align="center">
  <img src="apps/web-desktop/public/athena.svg" alt="Athena A icon" width="128">
</h1>

Athena is a web app and installable PWA for Hermes Agent, with a Docker image
for self-hosting. The renderer is pinned to the official Hermes release in
[`hermes-release.json`](hermes-release.json) and fetched from
[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) at
build time.

> This is intended for private networks such as Tailscale and is not hardened for the public internet.

In the sidebar Filters menu, choose **Profiles → Combined** to show profiles together,
or **Separate** to use the profile switcher. Choose **Grouping** independently:
None, Updated, Project, or Status. For example, Combined + Status groups chats by
status within each profile.

With Project grouping, drag a chat by its title onto another project to move it.
The destination highlights before you drop; press Escape
to cancel. Destinations need a working folder, so Home is not a drop target.

## Deliver scheduled results to a dedicated chat

With the optional gateway extension installed, set **Cron Jobs → Deliver to**
when creating or editing a job.

- **New chat on each run** creates a separate chat for every run that delivers
  text, even if you archived the previous chat.
- **Create dedicated chat** creates one chat for the job and appends later
  reports to it.

To switch an existing job to per-run chats, select **New chat on each run** and
clear **Create dedicated chat**. You can reply in either kind of chat with the
report in context. The gateway delivers while Athena is closed. Attachments
stay in run history, and `[SILENT]` runs skip delivery as usual.

Install the extension on the **Hermes gateway**, using the v0.23.0 release. For a
Docker gateway, build the extended image from the Athena repository:

```sh
docker build -t hermes-with-cron-chats integrations/hermes-cron-chat
```

Use `hermes-with-cron-chats` for the gateway container with its existing
configuration and data volume. For a source installation, run these commands
from the Athena repository with `HERMES_CHECKOUT` set to the path of a clean
Hermes v0.23.0 checkout. If upgrading a source installation of the extension,
use a fresh checkout with the same Hermes data directory.

```sh
git -C "$HERMES_CHECKOUT" apply --check "$PWD/integrations/hermes-cron-chat/cron-delivery.patch"
cp integrations/hermes-cron-chat/athena_cron_chat.py "$HERMES_CHECKOUT/gateway/"
git -C "$HERMES_CHECKOUT" apply "$PWD/integrations/hermes-cron-chat/cron-delivery.patch"
```

Restart Hermes to load the extension. The Athena UI image can connect to the
same gateway URL. For CLI-created jobs, use `--deliver new-chat-per-run` or
`--deliver dedicated-chat`.

## Docker self-hosting

The image contains Athena's UI, nginx and its small preferences/Android service.
It connects to an existing Hermes server; configure that server's HTTP(S) origin
in [compose.example.yml](compose.example.yml). Hermes keeps running independently
when the Athena container restarts or updates. The
[Compose setup guide](wiki/Run-with-Docker-Compose.md) covers a complete deployment
and migration from the combined image.

### 1. Configure the existing gateway

Edit the Athena service's environment in `compose.example.yml`:

```yaml
environment:
  HERMES_GATEWAY_URL: http://host.docker.internal:9119
  HERMES_GATEWAY_NAME: Hermes
```

Use the address reachable from the container, with no `/api` path. The example
uses a gateway on the Docker host; for another machine, use its HTTP(S) origin.
The Compose file can also read `HERMES_GATEWAY_URL` and `HERMES_GATEWAY_NAME`
from your shell or a local `.env` file. Configure models, profiles and sign-in
on the existing Hermes server. A standard `hermes serve` listener (normally port
9119) works with its existing sign-in and data. Athena's image handles the
browser connection compatibility; no Webapp listener, server-image replacement
or additional Hermes container is required. See
[gateway configuration](wiki/Gateway-Configuration.md).

### 2. Start Athena

```bash
docker compose -f compose.example.yml config --quiet
docker compose -f compose.example.yml up -d
```

Athena uses the configured server's existing login. It supports the standard
serve/dashboard connection and automatically uses the native Webapp connection
when that endpoint is available. Models, profiles and conversations stay on your
existing Hermes machine.

When migrating from the earlier Athena gateway address, set
`HERMES_GATEWAY_IDENTITY_URL` to that previous address, including its old port.
This preserves existing browser sign-in storage, synced preferences and Android
account ownership while requests go only to `HERMES_GATEWAY_URL`.
`ATHENA_PREFERENCES_IDENTITY_URL` remains accepted for existing stacks.

Open <http://localhost:4174/> and sign in to the configured Hermes server.
Compose publishes Athena's port 80 as 4174 and preserves preferences in the
`athena-preferences` volume. The Hermes data directory belongs to the existing
server and is not mounted by this Compose file.

If upgrading from the combined image, stop that container's gateway before
starting another server against the same Hermes data. Retain the Hermes data,
Athena preference volume and browser storage; only Athena's connection and port
mapping change here.

For filesystem plugins on the Athena host, optionally mount the plugin folders
read-only under `/data/hermes`. This is separate from the remote gateway's data.

Desktop plugin folders are discovered while Athena is open. Use Settings →
Plugins → Manage plugins to enable packaged desktop plugins, and Rescan after
editing an existing plugin.

To stop Athena:

```bash
docker compose -f compose.example.yml stop athena
```

For microphone access from another device, open Athena over HTTPS (for example,
through Tailscale Serve).

When **Update available** appears, you can refresh the UI during a running task.
Hermes keeps the task running, and Athena reconnects to the conversation after
the refresh. Text drafts are saved first; recordings, pending saves, and unsent
attachments still postpone the update. This applies to UI updates, not gateway
restarts or server changes.

### OpenCode Go usage

To show your subscription usage above **Settings** in the chat sidebar, add
`OPENCODE_GO_API_KEY` to Athena's Docker environment and recreate the container.
Use an API key from the subscribed workspace in the OpenCode Console. With
`compose.example.yml`, put it in your local Compose `.env` file or pass that file
with `docker compose --env-file`. For `docker run`, add it to `.env.hermes-web`
alongside the gateway settings.

The row shows the percentage remaining in the current subscription month. Hover
over it or focus it with the keyboard to see the percentage remaining and time
until reset for the 5-hour, weekly, and monthly windows. Athena keeps the key on
the server and shares the configured subscription's usage with signed-in users.

### Container logs

Follow startup and request diagnostics with:

```bash
docker compose -f compose.example.yml logs --follow athena
```

Startup JSON lines report the build revisions, release channel, listening
address, gateway origin, and plugin directory availability.
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

### Keyboard shortcuts

Open **Settings → Keyboard Shortcuts** to see the current bindings and change or
reset configurable shortcuts. The defaults below use **Mod** for **Command** on
macOS and **Ctrl** on Windows and Linux.

| Action | Default shortcut |
| --- | --- |
| Start a new chat | **Control+Command+N** on macOS. **Alt+N** in a Windows or Linux browser tab, or **Ctrl+N** in an installed Chromium app window. |
| Open the command palette | **Mod+K** |
| Show or hide the sidebar | **Mod+B** |
| Open the sidebar and focus chat search | **Mod+Shift+F** |
| Open Settings | **Mod+,** |
| Open Keyboard Shortcuts | **Mod+/** |
| Open the model picker | **Mod+Shift+M** |
| Focus the composer from the chat background | **Enter** |
| Open slash commands | **/** |
| Send a message | **Enter** in the composer |
| Insert a line break | **Shift+Enter** in the composer |
| Increase or decrease the interface scale | **Mod+=** or **Mod+-** |
| Reset the interface scale | **Mod+0** |

Athena also shows these fixed shortcuts in the chat action and sidebar filter
menus. Use them with focus outside text fields and with menus and dialogs closed.
Chat actions apply to the current chat.

| Action | Shortcut |
| --- | --- |
| Rename chat | **Mod+Shift+R** |
| Regenerate the chat title | **Mod+Shift+X** |
| Pin or unpin chat | **Mod+Shift+P** |
| Mark chat read or unread | **Mod+Shift+U** |
| Toggle Files or Review, when available | **Mod+Shift+E** or **Mod+Shift+G** |
| Archive chat | **Mod+Shift+A** |
| Open the delete confirmation | **Mod+Shift+Backspace** |
| Toggle the archived chats filter | **Mod+Alt+A** |
| Mark all chats read | **Mod+Alt+R** |

Use **Option** for **Alt** on macOS. If your browser or operating system takes
a shortcut first, use the corresponding menu action or rebind it in Settings
where available.

### Chat previews

Hover or keyboard-focus a chat to see a short summary of its purpose. Athena
generates summaries after completed turns while open, and fills older previews
on demand. It uses the chat profile's **Title generation** auxiliary model in
Settings → Models → Auxiliary; configure a cheap model there to reduce cost.
When that slot is unset, Hermes uses the profile's default model and its normal
provider fallback policy. Summaries use a small excerpt of the opening and recent
messages and a short output limit, without adding messages to the conversation.

The browser caches up to 100 summaries per account and gateway. They stay on
that browser and are separate from settings sync. Reopening an unchanged preview
reuses its cached summary; a failed generation retains the previous summary or
the latest-reply preview. Drafts, selection, and read status are preserved.

### Browser notifications

Open **Settings → Notifications → Allow browser notifications**, then accept
the browser prompt. Keep **Enable notifications** and **Response ready** on to
receive an alert when a reply finishes in your current chat while Athena is in
the background. Use **Send test notification** to check delivery. Clicking a
response notification returns to its conversation.

Plugin notifications can open their requested app page. Plugin callbacks run in
the window that emitted the alert; after that window closes, the click can still
open the saved destination. Action buttons appear where the browser supports
them.

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

To share files from another Android app, choose **Share → Athena**, then select an
existing chat or **New chat**. Search by chat title or profile. Shared images and
documents are appended to the chosen chat's draft; review them and tap Send when
ready. You can share up to 10 files, with a limit of 16 MiB per file and 32 MiB in
total. Files wait in the app's private cache while you connect or sign in; pending
shares expire after 24 hours. This needs an APK and hosted web interface that both
support incoming file sharing.

On supported APKs, open **Settings → App → App settings** at the bottom of Settings
for these Android controls. The separate Android header is hidden once Settings is ready and
returns during page loading or sign-in. Older APKs and older server versions
retain their native App settings button.

Settings, action menus, and the searchable model picker use the shared web
interface in both browsers and Android. The same Hermes code validates and saves
configuration changes. Older web clients can still use the APK's retained native
menu and Settings capabilities.

The native setup, App settings, and sign-in confirmation dialogs use Material 3, follow
the system light/dark theme, and use wallpaper colours on Android 12 and later.
Server setup includes inline address validation and a keyboard Connect action.

To exercise connection failures, open **App settings → Connection testing**, or
choose **Connection testing** on the initial server setup screen. Choose a server
that is unavailable, returns HTTP 503, does not provide Athena, or uses an
incompatible Android integration. The wrong-server case waits for the normal
20-second startup timeout. **Try again** repeats the chosen failure; **End test**
returns to your saved server, or setup if none is saved. These temporary scenarios
use an isolated test address and real WebView failure handling. They do not change
your saved server address or take your actual server offline. Entering testing
uses the same draft-saving, reply and recording checks as changing servers.

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

Hermes sign-in uses an Android Custom Tab. Complete sign-in and
approve the handoff in the browser, then return to the app. The server transfers
the session through a one-use PKCE exchange lasting five minutes. This moves
the browser's Athena session into the app so rotating refresh tokens are not
shared between two clients. Session-token sign-in remains available.

Athena alerts you on Android when new messages make a chat unread while the
web app is running. Open **Athena Settings → Notifications** to choose which
alerts to receive, control background delivery on this device, or send an Android
push test through Firebase.

Native alerts work without Firebase while the web app is running. In Android **App settings → Test notification**, send a local test alert to check notification permission and on-device display. This test does not contact Firebase or verify background push delivery. To receive
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

Browser sign-in opens the standard Hermes Agent login page. Hermes verifies
credentials and decides which authentication methods are accepted.

To sign out, open the settings menu and select **Sign out**. Athena saves your
text drafts and returns to the sign-in screen. Finish active responses or
recordings, and send or remove unsent attachments, before signing out.

Authentication is configured on the **Hermes backend**, separately from Athena's
container. Keep `/login`, `/auth`, and `/api` on Athena's browser-facing HTTPS
origin; the bundled nginx proxies these routes. Hermes handles credentials and
session refresh.

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
Sign in through Cloudflare Access**. On the startup connection-error screen,
**Review settings** opens the same controls. Athena checks failed or timed-out
connections for an Access login redirect or page and offers **Sign in through
Cloudflare Access** when detected. Generic network errors keep **Try again**.
Athena also offers this flow when it detects
an Access login redirect. The app opens your browser, where Pocket ID can use its
normal passkey prompt. After sign-in, the browser automatically returns to Athena
Android. If your browser blocks the automatic return, tap **Return to Athena
Android**. Athena imports the Access application cookie into its WebView and reloads after checking draft safety.

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
