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

The [Compose example](compose.example.yml) runs the published image
`ghcr.io/jtenniswood/athena:latest`. Its default gateway address is
`http://host.docker.internal:9119`; set `HERMES_GATEWAY_URL` to your gateway
address if it runs elsewhere.

```sh
docker compose -f compose.example.yml up -d
```

Open <http://localhost:4174/>. To stop Athena, run:

```sh
docker compose -f compose.example.yml down
```

To update to the latest published image:

```sh
docker compose -f compose.example.yml pull
docker compose -f compose.example.yml up -d
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
