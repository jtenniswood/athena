<h1 align="center">
  <img src="apps/web-desktop/public/hermes.svg" alt="Athena web app icon" width="128">
</h1>

Athena is an unofficial web app and installable PWA for Hermes Agent. It is a
frontend only; connect it to a running Hermes Gateway.

**Why Athena?** In Greek mythology, Athena sees the whole problem and devises
the plan; Hermes slips through obstacles, negotiates awkward missions, and
delivers the crucial message.

> Intended for private networks such as Tailscale. Athena is not hardened for
> the public internet.

## Run with Docker

Athena’s Docker image contains the web app and nginx. It connects to a Hermes
Gateway that you run separately. Docker Compose is optional; the [Compose wiki
guide](https://github.com/jtenniswood/athena/wiki/Run-with-Docker-Compose) has
instructions if you prefer it.

First, copy the environment template and set the gateway address:

```sh
cp apps/web-desktop/.env.example .env.hermes-web
```

For a gateway running on the Docker host, set these values in
`.env.hermes-web`:

```dotenv
HERMES_GATEWAY_URL=http://host.docker.internal:9119
HERMES_GATEWAY_NAME=Local Hermes
HERMES_HOME=/data/hermes
```

If your gateway runs elsewhere, use its reachable HTTP(S) address, such as its
Tailscale IP or MagicDNS hostname. Use the origin only; do not add a path such
as `/api`.

Start Athena with the published image:

```sh
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
installed `plugins/` and `desktop-plugins/`; remove the `-v` line if you do
not use filesystem plugins. On Linux, `--add-host` lets the container reach a
gateway running on the Docker host.

To stop Athena:

```sh
docker stop athena
```

Use HTTPS or Tailscale Serve when opening Athena from another device, especially
for microphone access.

## Acknowledgment

Athena is an original project based on the work of
[hermes-desktop-web-mobile-pwa](https://github.com/mdg-qc/hermes-desktop-web-mobile-pwa),
with extensive improvements for web and mobile.

## License

Athena is licensed under the [MIT License](LICENSE). The renderer fetched from
[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent)
retains its own license and copyright notices. Third-party dependencies remain
under their respective licenses.
