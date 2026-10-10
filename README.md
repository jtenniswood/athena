<h1 align="center">
  <img src="apps/web-desktop/public/athena.svg" alt="Athena A icon" width="128">
</h1>

Athena is a web app and installable PWA for Hermes Agent, with a Docker image
for self-hosting. The pinned Hermes Desktop renderer is fetched from
[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) at
build time.

> This is intended for private networks such as Tailscale and is not hardened for the public internet.

## Docker self-hosting

The image contains Athena’s web UI and nginx. It connects to a separate,
already-running Hermes Gateway. The quickest setup uses the published Docker
image and `docker run`; Compose is optional. See the [Compose wiki guide](https://github.com/jtenniswood/athena/wiki/Run-with-Docker-Compose)
if you prefer Compose.

### 1. Create the environment file

Copy the template, then edit `.env.hermes-web` and set the gateway address:

```bash
cp apps/web-desktop/.env.example .env.hermes-web
```

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
  -v "$HOME/.hermes:/data/hermes:ro" \
  ghcr.io/jtenniswood/athena:latest
```

Open <http://localhost:4174/>. The mounted Hermes directory lets Athena serve
installed `plugins/` and `desktop-plugins/`; remove the `-v` line if you do not
use filesystem plugins.

To stop Athena:

```bash
docker stop athena
```

For microphone access from another device, open Athena over HTTPS (for example,
through Tailscale Serve).

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

### Acknowledgment

Athena is an original project based on the work of
[hermes-desktop-web-mobile-pwa](https://github.com/mdg-qc/hermes-desktop-web-mobile-pwa),
with extensive improvements for web and mobile.
