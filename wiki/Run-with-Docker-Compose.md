# Run Athena with Docker Compose

Athena serves the UI and connects to an existing Hermes server. Compose runs
only Athena; models, profiles, conversations and authentication stay on Hermes.
The UI renderer is pinned to the official release recorded in the repository's
`hermes-release.json`.

## 1. Configure the existing Hermes server

Use the HTTP(S) address of your existing Hermes server, normally its standard
serve/dashboard listener on port 9119. Keep that server's current sign-in,
profiles, data and model configuration. Athena's image supplies browser socket
compatibility; no Webapp listener or additional Hermes service is required.

For a server on the Docker host, the example uses
`http://host.docker.internal:9119`. For another machine, use its reachable
hostname and port. See [Gateway configuration](Gateway-Configuration).

## 2. Configure Athena in Compose

Use `compose.example.yml` from the repository, or save the following as
`compose.yml` in your deployment directory:

```yaml
services:
  athena:
    image: ghcr.io/jtenniswood/athena:latest
    restart: unless-stopped
    ports:
      - "4174:80"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - athena-preferences:/data/athena
    # Set the existing Hermes server origin here, or in a local .env file.
    environment:
      HERMES_GATEWAY_URL: ${HERMES_GATEWAY_URL:-http://host.docker.internal:9119}
      # On migration, retain the previous gateway URL as its stable storage identity.
      HERMES_GATEWAY_IDENTITY_URL: ${HERMES_GATEWAY_IDENTITY_URL:-}
      HERMES_GATEWAY_NAME: ${HERMES_GATEWAY_NAME:-Hermes}

volumes:
  athena-preferences:
```

Edit `HERMES_GATEWAY_URL` to the existing server's HTTP(S) origin, without an
`/api` path. The default reaches a server on the Docker host. For a server on
another machine, use its reachable hostname and port. `localhost` inside the
Athena container refers to Athena itself.

You can set the address directly in Compose, or supply the two interpolated
values in a local `.env` file beside it:

```dotenv
HERMES_GATEWAY_URL=http://hermes.example.com:9119
HERMES_GATEWAY_NAME=Hermes
```

The repository's `apps/web-desktop/.env.example` is for Vite development.
Production setup uses the Compose `environment` block above.

Keep the `athena-preferences` volume when recreating the service. The existing
Hermes data directory stays with the Hermes server. Filesystem plugins hosted
on Athena's machine can optionally be mounted read-only under `/data/hermes`;
the basic Compose setup needs no Hermes directory mount.

## 3. Validate and start Athena

For a deployment directory containing `compose.yml`:

```sh
docker compose config --quiet
docker compose up -d
docker compose logs --follow athena
```

From a repository checkout using the supplied example, use
`docker compose -f compose.example.yml` in place of `docker compose`.

Open <http://localhost:4174/> and sign in with your existing Hermes account.
If you change the host port, update the left side of `4174:80`. For microphone
access from another device, expose Athena over HTTPS. If an existing tunnel
uses Athena's container port 4174, set `HERMES_PORT: '4174'`, map `4174:4174`,
and update its health-check URL to that port.

Check that profiles and existing conversations appear, send a message, and
reload with an unsent text draft to confirm it is restored.

## Update or stop Athena

Pull the selected image and recreate only Athena:

```sh
docker compose pull athena
docker compose up -d athena
```

Athena reconnects to the existing Hermes server. Finish recordings and send or
remove unsent attachments before recreating the UI container. Text drafts and
preferences stay in browser storage and the preference volume.

To stop Athena, retaining its container and volume:

```sh
docker compose stop athena
```

To remove the stopped service while retaining its named volume:

```sh
docker compose down
```

## Moving from the combined image

Stop the combined Athena container before starting a separate Hermes process
against its data. Configure your existing Hermes service to use the preserved
Hermes data, profiles and model/authentication settings. Connect the UI-only
Athena image to that service with `HERMES_GATEWAY_URL` and change its port mapping
to `4174:80`.

Reuse the existing Athena preference volume and the same browser origin. Keep
browser storage and the Hermes data intact. Once Hermes owns its data again,
Athena's Compose service needs only its preference volume.

## Optional listener migration

The existing dashboard/serve connection can stay on port 9119. If you choose to
use an already enabled Webapp listener instead, change `HERMES_GATEWAY_URL` and
retain the previous origin in `HERMES_GATEWAY_IDENTITY_URL`. That identity keeps
browser storage, preferences and Android account ownership stable; requests
still go only to the configured target. The earlier
`ATHENA_PREFERENCES_IDENTITY_URL` name remains supported.

Keep the existing preference volume and tunnel target. No Python configuration
service or Hermes data mount belongs in Athena's UI-only service.
