# syntax=docker/dockerfile:1
# The renderer revision is read from flake.lock by every build path.
FROM node:26-bookworm-slim AS dependencies
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml flake.lock renovate.json ./
RUN npm install --global "$(node -p 'require("./package.json").packageManager')"
COPY scripts ./scripts
COPY apps/web-desktop/package.json apps/web-desktop/package.json
RUN node scripts/renderer.mjs \
 && node scripts/renderer-dependencies.mjs \
 && pnpm install --frozen-lockfile
RUN node -e "require('node:fs').cpSync(require('node:path').dirname(require.resolve('ws/package.json')), '/runtime-ws', { recursive: true })"
FROM dependencies AS build
COPY apps/web-desktop ./apps/web-desktop
COPY docs ./docs
COPY tests ./tests
COPY hermes-release.json ./
ARG HERMES_WRAPPER_REV=unknown
ARG HERMES_RELEASE_CHANNEL=local
ARG SOURCE_DATE_EPOCH
ENV HERMES_WRAPPER_REV=$HERMES_WRAPPER_REV \
    HERMES_RELEASE_CHANNEL=$HERMES_RELEASE_CHANNEL \
    SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH
RUN node scripts/renderer.mjs --check \
 && node scripts/official-release.mjs \
 && pnpm run typecheck \
 && pnpm --filter web-desktop run build

# Optional synthetic backend, built only for the isolated review stack.
FROM dependencies AS preview-dependencies
RUN node -e "require('node:fs').cpSync(require('node:path').dirname(require.resolve('ws/package.json')), '/preview-ws', { recursive: true })"

FROM node:26-bookworm-slim AS preview-gateway
WORKDIR /app
COPY --from=preview-dependencies /preview-ws ./node_modules/ws
COPY scripts/preview ./scripts/preview
ENV HOST=0.0.0.0 PORT=9129
USER node
EXPOSE 9129
CMD ["node", "scripts/preview/gateway.mjs"]

# ---- runtime stage: nginx -------------------------------------------------------
FROM nginx:alpine AS browser-preview
# Node owns account preference storage; nginx serves the UI and proxies Hermes.
RUN apk add --no-cache nodejs

# The gateway URL + HERMES_HOME are injected by docker-entrypoint.sh via
# the shared validated configuration generator at container start.
COPY nginx.conf.template /etc/nginx/hermes.conf.template
COPY scripts/runtime-config.mjs /opt/hermes/runtime-config.mjs
COPY scripts/preference-schema.mjs scripts/browser-preference-contract.mjs scripts/runtime-config.mjs /opt/hermes/scripts/
COPY apps/web-desktop/server /opt/hermes/apps/web-desktop/server
COPY --from=dependencies /runtime-ws /opt/hermes/node_modules/ws
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

COPY --from=build /app/apps/web-desktop/dist /usr/share/nginx/html

# Defaults — override with -e at runtime.
ENV HERMES_GATEWAY_URL=http://127.0.0.1:9119 \
    HERMES_HOME=/data/hermes \
    HERMES_PREFERENCES_DIR=/data/athena

VOLUME /data/athena

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "/opt/hermes/apps/web-desktop/server/main.mjs"]

# The released Hermes runtime owns the gateway, authentication and Webapp server.
FROM nousresearch/hermes-agent@sha256:e6d81ae52ebf6a43efa529701405509f20054ba818f179ddd748bed4f8af584c AS runtime
COPY hermes-release.json /opt/athena/hermes-release.json
RUN /opt/hermes/.venv/bin/python -c "import json; from pathlib import Path; release=json.loads(Path('/opt/athena/hermes-release.json').read_text()); stamp=json.loads(Path('/opt/hermes/install-stamp.json').read_text()); assert stamp['commit'] == release['revision'], 'Official image and renderer release differ'"
COPY --from=build --chmod=a+rX /app/apps/web-desktop/dist /opt/athena/ui
COPY --from=dependencies --chmod=a+rX /runtime-ws /opt/athena/node_modules/ws
COPY --chmod=a+rX apps/web-desktop/server /opt/athena/apps/web-desktop/server
COPY --chmod=a+rX scripts/runtime-config.mjs scripts/preference-schema.mjs scripts/browser-preference-contract.mjs /opt/athena/scripts/
COPY --chmod=0755 docker/s6-rc.d/athena/run /etc/s6-overlay/s6-rc.d/athena/run
COPY docker/s6-rc.d/athena/type /etc/s6-overlay/s6-rc.d/athena/type
COPY docker/s6-rc.d/athena/dependencies.d/base /etc/s6-overlay/s6-rc.d/athena/dependencies.d/base
COPY docker/s6-rc.d/user/contents.d/athena /etc/s6-overlay/s6-rc.d/user/contents.d/athena
ENV HERMES_WEBAPP_DIST=/opt/athena/ui \
    HERMES_STATIC_ROOT=/opt/athena/ui \
    HERMES_PREFERENCES_DIR=/data/athena \
    HERMES_PORT=4174
RUN mkdir -p /data/athena && chown hermes:hermes /data/athena
VOLUME /data/athena
EXPOSE 4174
CMD ["gateway", "run"]
