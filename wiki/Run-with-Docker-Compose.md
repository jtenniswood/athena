# Run Athena with Docker Compose

Athena serves the UI and connects to an existing Hermes server. Compose runs
only Athena; models, profiles, conversations and authentication stay on Hermes.
The UI renderer is pinned to the official release recorded in the repository's
`hermes-release.json`.

## 1. Configure the existing Hermes server

Choose the two addresses before starting Athena:

| Setting | Where to configure it | Meaning |
| --- | --- | --- |
| `HERMES_GATEWAY_URL` | Athena's Compose service | Hermes HTTP(S) origin reachable from the Athena container, such as `http://host.docker.internal:9120`. |
| `webapp.public_url` | Existing Hermes server | Athena's browser-facing URL, such as `http://localhost:4174` or `https://athena.example.com`. |

For a local browser setup, merge this into the existing Hermes `config.yaml`,
preserving its other settings:

```yaml
webapp:
  enabled: true
  host: 0.0.0.0
  port: 9120
  public_url: "http://localhost:4174"
```

For remote access, use the HTTPS address you actually open instead. Apply the
setting using your existing Hermes service's configuration/restart procedure.
With the official image's default entrypoint, use `command: ["gateway", "run"]`
on that service; replace a `serve` override, which starts the separate dashboard.
Keep its existing volumes, authentication, model credentials and other ports.
Publish 9120 as well if Athena uses a host address. See
[Gateway configuration](Gateway-Configuration) for address and sign-in details.

To keep the server's Webapp configuration inline in Compose, use the
[Hermes server override](Gateway-Configuration#keep-the-webapp-settings-inside-compose)
alongside that server's existing Compose file.

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
      HERMES_GATEWAY_URL: ${HERMES_GATEWAY_URL:-http://host.docker.internal:9120}
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
HERMES_GATEWAY_URL=http://hermes.example.com:9120
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

Open <http://localhost:4174/> and sign in. If you change the host port, update
the left side of `4174:80` and Hermes's public URL to match. For microphone
access from another device, expose Athena over HTTPS and use that same HTTPS
URL in the browser and Hermes public-URL setting.

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

## Move from the dashboard connection

Enable the Webapp listener on the existing Hermes service and publish its port
if Athena reaches it through a host address. Set Athena's `HERMES_GATEWAY_URL`
to that listener, normally port 9120, and `HERMES_GATEWAY_IDENTITY_URL` to the
previous gateway origin (normally the same host on port 9119). Keep the identity
setting on subsequent updates. It identifies existing storage; requests and
credentials are sent only to the new target. The earlier
`ATHENA_PREFERENCES_IDENTITY_URL` name remains supported.

Set `webapp.public_url` on Hermes to Athena's public browser URL. Redeploy the
Hermes configuration before the new Athena image. Keep Athena's `4174:80` mapping,
Cloudflare's host-port target and the existing preference volume. No Python
configuration service or Hermes data mount belongs in Athena's UI-only service.
