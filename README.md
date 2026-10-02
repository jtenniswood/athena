<h1 align="center">
  <img src="apps/web-desktop/public/athena.svg" alt="Athena A icon" width="128">
</h1>

Athena is a web app and installable PWA for Hermes Agent, with a Docker image
for self-hosting. The pinned Hermes Desktop renderer is fetched from
[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) at
build time.

> This is an unofficial, AI-generated project. It is intended for private
> networks such as Tailscale and is not hardened for the public internet.

## Repository

- `apps/web-desktop/` — Athena web app, bridge, styles, and overrides
- `flake.nix` — Nix development and production build
- `Dockerfile` — Nix-free frontend image using nginx
- `apps/web-desktop/.env.example` — local and Docker configuration template

The upstream renderer is supplied by the Nix flake or fetched by Docker. Do
not add or edit `apps/desktop/` or `apps/shared/`; those directories contain
upstream renderer sources.

## Development

```bash
corepack enable
pnpm prepare:renderer
pnpm install --frozen-lockfile
pnpm dev
```

This is a personal project in early development. Keep changes small and the
feedback loop short: typecheck, build, and manually try the affected workflow.
A full test suite and release evidence record are not required for routine work.

Open <http://localhost:5174/>. Check a change with:

```bash
pnpm typecheck
pnpm build
```

Existing tests are optional tools for investigating a specific risk. Use focused
checks when changing draft persistence, conversation selection, authentication,
or update safety. Styling and other reversible UI changes usually need only a
manual check at the affected screen size.

For shared design tokens, component choices, and responsive checks, see the
[web UI styling guide](docs/ui-styles.md).

## Settings customization

Settings uses the same five groups on phone, tablet, and desktop: Preferences,
Assistant, Tools, Service, and Maintenance.
Configuration lets you export, restore, or reset the current profile. It does not
include conversations, credentials, or server files. Search accepts current and
previous upstream page names.

Edit `apps/web-desktop/src/experience/settings/policy.ts` to customize the menu:

- `settingsGroups` assigns pages to groups and sets their default order.
- `pageLabels` and `pageAliases` define display names and additional search terms.
- `settingsPolicy.sections.hidden` hides pages using their existing IDs.
- `settingsPolicy.sections.order` overrides page order within groups.
- `settingsPolicy.fields.hidden` hides fields and appearance controls without
  deleting their saved values.

The web wrapper also gates custom desktop controls through fingerprinted renderer
transforms. Keep page IDs unchanged so existing settings links continue to work.
New upstream fields remain in their original pages, and new pages appear under
Other Settings until assigned a group. About is hidden by default. The wrapper
reuses upstream forms and save handlers for controls that remain available.

## Build and deploy

GitHub Actions typechecks and builds the Docker image, publishes it, and deploys
that exact image after a push to `main`. The deployment restores the previous
image if the container health check fails. Version tags and manual builds only
publish images. See [releases and rollback](docs/releases.md) for setup and how
to restore an earlier image if a manual check finds a problem.

The optional static deployment script at `apps/web-desktop/scripts/deploy.sh`
accepts an already-built web artifact. It stages immutable release directories
and changes the `current` link; it does not build or restart a service.

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
