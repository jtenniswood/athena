# Run Athena with Docker Compose

Docker Compose is optional. For the direct Docker setup, see the main
[README](https://github.com/jtenniswood/athena#run-with-docker).

Athena serves the web app and proxies requests to a Hermes Gateway that you
run separately. The Compose service does not start a gateway or model runtime.

For identity-provider sign-in, follow [Set up OIDC](Set-up-OIDC) after configuring
the backend connection and HTTPS access.

## 1. Create the environment file

From the repository root, copy the supplied template:

```sh
cp apps/web-desktop/.env.example .env.hermes-web
```

Edit `.env.hermes-web` and set `HERMES_GATEWAY_URL` to the gateway address.
For a gateway running on the same Docker host, use:

```dotenv
HERMES_GATEWAY_URL=http://host.docker.internal:9119
HERMES_GATEWAY_NAME=Local Hermes
HERMES_HOME=/data/hermes
```

If the gateway runs elsewhere, use an address reachable from the Docker host,
such as its Tailscale IP or MagicDNS hostname. Use only the HTTP(S) origin; do
not add a path such as `/api`.

## 2. Create `compose.yml`

Save this file beside `.env.hermes-web`:

```yaml
services:
  athena:
    image: ghcr.io/jtenniswood/athena:latest
    container_name: athena
    restart: unless-stopped
    env_file:
      - .env.hermes-web
    extra_hosts:
      - host.docker.internal:host-gateway
    ports:
      - "4174:80"
    volumes:
      - "${HOME}/.hermes:/data/hermes:ro"
```

The volume gives Athena read-only access to installed `plugins/` and
`desktop-plugins/` assets in your Hermes home directory. Remove the `volumes`
section if you do not use filesystem plugins.

## 3. Start Athena

Run these commands from the directory containing `compose.yml`:

```sh
docker compose up -d
```

Open <http://localhost:4174/>. If you use a different host port, change the
left side of the `ports` mapping and use that port in the browser.

To view startup logs:

```sh
docker compose logs -f athena
```

To stop and remove the container:

```sh
docker compose down
```

## Update Athena

Pull the latest published image and recreate the service:

```sh
docker compose pull
docker compose up -d
```

The environment file and host Hermes directory remain in place. For microphone
access from another device, expose Athena over HTTPS, for example with Tailscale
Serve.
