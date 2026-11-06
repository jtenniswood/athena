# Configure the existing Hermes gateway

Athena connects to one operator-configured Hermes server. Set its address in
Athena's Compose service; configure models, profiles and authentication on that
existing server.

## Backend address

`HERMES_GATEWAY_URL` is an HTTP(S) origin reachable from the Athena container:

| Existing Hermes location | Example target |
| --- | --- |
| Docker host, listening on a container-reachable interface | `http://host.docker.internal:9120` with the supplied `extra_hosts` entry. |
| Another machine | `https://hermes.example.com` or an HTTP hostname and port reachable over your private network. |
| Another container on a shared Docker network | That container's network name and listening port. |

Use the existing Hermes gateway's Webapp listener, which defaults to port 9120.
A server bound only to its own loopback interface cannot be reached from a
separate container; make it reachable through your existing private-network or
proxy configuration.

Leave `/api` off the address. Athena proxies HTTP API calls, sign-in routes and
WebSockets through its own browser origin, so the browser opens Athena's URL.

## Browser address and sign-in

Enable `webapp` in the existing Hermes `config.yaml` and set its public URL to
the address used to open Athena. For example:

```yaml
webapp:
  enabled: true
  host: 0.0.0.0
  port: 9120
  public_url: "https://athena.example.com"
```

For a local browser on port 4174, use `http://localhost:4174`. Apply the setting
through the existing Hermes service. This setting governs sign-in redirects and
browser-origin validation; it is separate from Athena's backend target address.

The running Hermes gateway starts this listener. With the official Docker
image's default entrypoint, use `command: ["gateway", "run"]` on the existing
Hermes service. If that service currently overrides its command with `serve`,
replace that override; `serve` starts the separate dashboard. Keep the existing
data mount, authentication, model settings and other published ports. Publish
9120 as well when Athena reaches Hermes through a host port. See the
[official Webapp Docker setup](https://hermes-agent.nousresearch.com/docs/user-guide/docker#running-the-webapp).

Configure the server's supported sign-in provider there. Athena's welcome screen
opens Hermes sign-in and resumes chat after a session is established. Existing
session-token installations can use **Use a session token** on the welcome
screen. Keep tokens and provider secrets out of the tracked Compose example.

### Configure Webapp through the server image

The `ghcr.io/jtenniswood/athena-hermes` companion image adds a small startup hook
to the pinned official Hermes release. It runs on the **existing Hermes service**,
with its existing data and credentials. Athena's own image stays UI-only. Add
[`compose.hermes-webapp.override.yml`](../compose.hermes-webapp.override.yml)
after the existing **Hermes server** Compose file. It inherits the existing
volumes, credentials and other ports, and selects the companion image. If its service has a name other
than `hermes`, change that service key in the override to match.

```sh
HERMES_WEBAPP_PUBLIC_URL=https://athena.example.com docker compose \
  -f compose.yml -f compose.hermes-webapp.override.yml up -d hermes
```

Set `HERMES_WEBAPP_PUBLIC_URL` to the address used to open Athena. In Komodo, include
both Compose files in the existing Hermes stack, with the override second, and
set the variables in the stack environment. The setup code is built into the
companion image. Each start validates these settings, merges the Webapp keys
through Hermes's config writer, and starts the gateway through its original
bootstrap. The remaining config stays intact. No shell script or separate
Webapp YAML file is needed in the stack.

| Compose setting | Default | Purpose |
| --- | --- | --- |
| `ATHENA_HERMES_IMAGE` | `ghcr.io/jtenniswood/athena-hermes:dev-latest` | Companion image; an immutable `dev-sha-<revision>` tag can pin it. |
| `HERMES_WEBAPP_ENABLED` | `true` | Enable the Webapp listener; `false` leaves the gateway running without it. |
| `HERMES_WEBAPP_HOST` | `0.0.0.0` | Bind address inside the server container. |
| `HERMES_WEBAPP_PORT` | `9120` | Listener and published port. Match Athena's target to this port. |
| `HERMES_WEBAPP_PUBLIC_URL` | Required when enabled | Athena's browser-facing HTTP(S) origin. `ATHENA_PUBLIC_URL` remains an alias. |
| `HERMES_DASHBOARD` | `1` in the migration override | Keep the earlier dashboard available during migration; set `0` when it is no longer needed. |

The companion uses the official image's root initialization, then runs Hermes
as its own user. Keep its default entrypoint and `init: false` so the startup
hook runs before profile gateways start. Model and authentication settings remain
on the existing server and can continue to use its config and environment.

Keep Athena in its existing stack with `HERMES_GATEWAY_URL` targeting that
listener and the previous origin retained in `HERMES_GATEWAY_IDENTITY_URL`.

## Check a connection

Start with Athena's logs:

```sh
docker compose logs --follow athena
```

Use `-f compose.example.yml` when running the repository's supplied example.
In Athena, open Settings → Gateway and use **Test connection**. The status
endpoint is also available through the UI origin:

```sh
curl --fail http://localhost:4174/api/status
```

If the server cannot be reached, check the Compose target, listening interface,
published port and network access. If sign-in or WebSockets fail after the page
loads, check Hermes's public URL and ensure the reverse proxy forwards `/api`,
`/auth`, `/login` and WebSocket upgrades to Athena.

Keep the preference volume and browser storage while fixing connectivity.
Return to [Docker Compose setup](Run-with-Docker-Compose) for start/update commands.

## Version and mode diagnostics

Settings → Gateway shows the interface's pinned Hermes release and the running
server version. Test connection also checks that the Webapp socket-ticket route
is available. A dashboard/serve target produces guidance to enable Webapp and
correct the configured address, rather than an unexplained ticket error.

The release integration check uses the immutable `gatewayImage` in
`hermes-release.json`, and verifies that its installation commit matches the
renderer pin. This pins both the companion server base and the tested backend. The operator's
running server changes only when its stack is redeployed with that image. Other
backend versions require their own compatibility verification.

For a listener migration, set `HERMES_GATEWAY_IDENTITY_URL` to the old origin to
preserve the existing storage namespace. Do not reuse an identity for a different
Hermes installation or account authority.
