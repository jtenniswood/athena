# Configure the existing Hermes gateway

Athena connects to one operator-configured Hermes server. Set its address in
Athena's Compose service; configure models, profiles and authentication on that
existing server.

## Backend address

`HERMES_GATEWAY_URL` is an HTTP(S) origin reachable from the Athena container:

| Existing Hermes location | Example target |
| --- | --- |
| Docker host, listening on a container-reachable interface | `http://host.docker.internal:9119` with the supplied `extra_hosts` entry. |
| Another machine | `https://hermes.example.com` or an HTTP hostname and port reachable over your private network. |
| Another container on a shared Docker network | That container's network name and listening port. |

Use the existing standard Hermes server's listener, normally port 9119. A
server bound only to its own loopback interface cannot be reached from a
separate container; use the same reachable address as your current setup.

Leave `/api` off the address. Athena proxies HTTP API calls, sign-in routes and
WebSockets through its own browser origin, so the browser opens Athena's URL.

## Browser address and sign-in

Use the sign-in provider already configured on your Hermes installation.
Athena proxies sign-in and API requests through its own browser origin. The
image first tries the released renderer's native Webapp connection; on a standard
serve/dashboard listener it uses Hermes's existing authenticated socket tickets
and the renderer's built-in standard-server protocol support instead.

The image validates the browser's origin and forwards the standard socket over
a fixed proxy hop, so Hermes does not need a new public URL or listener for
Athena. Long-lived tokens stay out of browser socket URLs; a standard loopback token is
exchanged for a short-lived, single-use image-side handle before the socket
opens. Hermes still validates the actual credential. Rejected sign-ins and
unavailable servers are reported rather than treated as a compatibility switch.

For standard servers without the browser file-staging endpoint, Athena retains
selected files in browser memory and uses Hermes's existing attachment RPC when
sending. Native Webapp staging remains available on servers that expose it.

Keep Athena's Compose file UI-only. A Hermes installation running directly on
another machine continues to run there with its existing profile, credentials
and data; no Hermes container belongs in Athena's stack. Existing Webapp
listeners (often port 9120) remain supported, but enabling one is optional.

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
server version. Test connection checks the selected server's supported socket
connection, including the standard-server fallback.

The release integration check uses the immutable official `gatewayImage` in
`hermes-release.json` with Webapp disabled and the standard serve listener. It
verifies sign-in, chat, drafts, attachments, approvals and profiles against that
release. The image is a disposable CI fixture; the production Athena image
contains no Hermes runtime and does not change the operator's server.

For a listener migration, set `HERMES_GATEWAY_IDENTITY_URL` to the old origin to
preserve the existing storage namespace. Do not reuse an identity for a different
Hermes installation or account authority.
