# Set up OIDC sign-in

Athena can use an OpenID Connect (OIDC) identity provider for sign-in through
Hermes Agent. Hermes handles the authentication and session cookies; Athena
serves the chat interface and proxies the authentication routes.

Start with a working [Docker setup](Quick-Start) or [Compose setup](Run-with-Docker-Compose)
and [HTTPS access](Remote-Access). This guide uses `https://athena.example.com`
as the address you open in your browser. Replace every example URL and client
ID with your own values. Keep Athena on your private network.

## 1. Register a client with your identity provider

Create an OpenID Connect application/client with these settings:

| Setting | Value |
| --- | --- |
| Client type | Public |
| Grant / flow | Authorization code |
| PKCE | Required, using S256 |
| Client ID | For example, `hermes-dashboard` |
| Allowed redirect URI | `https://athena.example.com/auth/callback` |
| Scopes | `openid profile email` |

Allow the intended users or groups to access this application in your identity
provider. Copy its **issuer URL**, rather than its login page or authorization
endpoint. For example, an Authentik issuer can be
`https://auth.example.com/application/o/hermes/`; a Keycloak realm issuer can be
`https://auth.example.com/realms/hermes`.

The callback uses Athena's browser-facing HTTPS origin. Do not register
`host.docker.internal`, the backend address, or a URL ending in `/login` as the
callback. The public PKCE setup used here does not need a client secret.

## 2. Configure the Hermes backend

Set these variables in the environment of the process or container running
`hermes dashboard`, or in its Hermes `.env` file:

```dotenv
HERMES_DASHBOARD_OIDC_ISSUER=https://auth.example.com/application/o/hermes/
HERMES_DASHBOARD_OIDC_CLIENT_ID=hermes-dashboard
HERMES_DASHBOARD_PUBLIC_URL=https://athena.example.com
```

The default scopes are `openid profile email`. Set
`HERMES_DASHBOARD_OIDC_SCOPES` only if your provider requires a different scope
list. Hermes must be able to reach the issuer's HTTPS discovery and signing-key
endpoints.

Restart the Hermes backend using your existing service or container setup.
Its bundled `self-hosted` OIDC provider registers when the issuer and client ID
are configured. A non-loopback `HERMES_DASHBOARD_PUBLIC_URL` engages the
authentication gate, including when the backend itself binds to loopback.

These are **backend settings**. Putting them only in Athena's environment file
or mounting the Hermes directory into Athena does not configure the running
backend. Athena and Hermes are separate services.

## 3. Configure HTTPS and trusted proxies

Route `https://athena.example.com` to Athena's nginx container, with WebSocket
support. Its bundled proxy already forwards `/login`, `/auth`, and `/api` to
Hermes. Keep these routes on the same browser origin as the chat interface.

Your HTTPS proxy must forward the original host and scheme. If Hermes receives
requests from a non-loopback proxy peer, merge a trusted-proxy entry into the
backend's existing `config.yaml`:

```yaml
dashboard:
  trusted_proxies:
    - "<Athena nginx peer IP as seen by Hermes>"
```

Replace the placeholder with the actual connecting proxy address. For dynamic
addresses, use a bounded CIDR for a dedicated proxy network. Trust the peer
Hermes sees, which is usually Athena's nginx container; listing only the outer
HTTPS proxy may be insufficient. Do not use wildcard trust.

`HERMES_DASHBOARD_PUBLIC_URL` fixes the callback address. Correctly trusted
forwarded HTTPS headers are also needed for secure session cookies.

## 4. Configure and recreate Athena

Keep the backend connection in Athena's `.env.hermes-web`:

```dotenv
HERMES_GATEWAY_URL=http://host.docker.internal:9119
HERMES_GATEWAY_NAME=Hermes
```

Use the address reachable from Athena's container, as explained in
[Gateway configuration](Gateway-Configuration). This can be an internal HTTP
origin while the browser-facing Athena address uses HTTPS.

Athena automatically detects registered providers. With only the self-hosted
provider, the welcome screen offers **Sign in with Self-Hosted OIDC**. With
multiple providers, **Sign in** opens Hermes's provider chooser.

Images that include [Docker sign-in mode support](https://github.com/jtenniswood/athena/pull/237)
can additionally select OIDC directly:

```dotenv
HERMES_AUTH_MODE=oidc
```

This optional setting selects Athena's sign-in flow. Automatic detection also
works on images without it; the backend OIDC settings above are still required.

For Compose, apply environment changes by recreating the service:

```sh
docker compose up -d --force-recreate athena
```

For `docker run`, recreate the container using your original command and the
updated `--env-file`. Restarting an existing container does not replace its
environment variables.

## 5. Verify sign-in

Before signing in, check the public provider list through Athena:

```sh
curl -fsS https://athena.example.com/api/auth/providers
```

Look for a provider named `self-hosted` with `supports_password: false`.
Then open Athena, select the OIDC provider, and sign in. Mobile browsers and
installed PWAs use the current window; desktop browsers can use a popup.

After sign-in, open `https://athena.example.com/api/auth/me` in the **same
browser**. Its JSON response should contain `"provider": "self-hosted"`.
An unauthenticated `curl` request to that endpoint should still return `401`.
Return to Athena and confirm that chat connects. Use **Sign out** in the
settings menu to check that Athena returns to the welcome screen.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `self-hosted` is missing from the provider list | The issuer and client ID must reach the running Hermes backend. Restart that backend and check its provider-registration logs. |
| The identity provider rejects the redirect URI | Register the exact browser-facing `https://athena.example.com/auth/callback` URL and set the same origin in `HERMES_DASHBOARD_PUBLIC_URL`. |
| Sign-in loops or chat reports an expired session immediately | Check HTTPS forwarding, Hermes's trusted proxy peers, and that `/auth` and `/api` use Athena's origin. |
| Provider discovery or token verification fails | Check the issuer URL, HTTPS certificates, and discovery/JWKS reachability from the Hermes backend. |
| Chat fails to connect after authentication | Confirm the HTTPS proxy supports WebSocket upgrades for `/api/ws`. Check Athena and Hermes logs. |
| Signing in again does not ask for a password | Your identity provider may still have an SSO session. Signing out of Athena does not necessarily sign you out of the identity provider. |

OIDC controls access to the connected Hermes instance. It does not create
separate Athena workspaces or isolate each user's conversations.

For the backend details, see the
[Hermes OIDC and proxy documentation](https://github.com/NousResearch/hermes-agent/blob/f97608f178d1ffeca59860195ab7da295f7c8e5f/website/docs/user-guide/features/web-dashboard.md#self-hosted-oidc-provider).
