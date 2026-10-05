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

### Acknowledgment

Athena is an original project based on the work of
[hermes-desktop-web-mobile-pwa](https://github.com/mdg-qc/hermes-desktop-web-mobile-pwa),
with extensive improvements for web and mobile.
