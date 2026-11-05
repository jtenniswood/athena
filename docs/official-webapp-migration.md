# Moving Athena onto the official Hermes Webapp

Athena's default image now extends the official Hermes release named in
`hermes-release.json`. The frontend source revision in `flake.lock` must match
the runtime image's installation stamp. Docker builds reject a mismatch.
The official gateway serves Athena's bundle through `HERMES_WEBAPP_DIST`.

Hermes owns browser authentication, tickets, files, profiles and chat state.
Athena adds its interface, PWA lifecycle, account preferences and Android
services. Its small Node service forwards ordinary requests and sockets to the
official Webapp server. The official entrypoint and s6 supervision remain in use.
The default image no longer runs nginx or Athena's desktop compatibility bridge.

## Existing installations

1. Record the current immutable Athena and gateway image references and runtime
   configuration. Finish or stop active tasks, then stop both old containers.
   Never run two gateways against the same Hermes directory.
2. Take an offline backup of the Hermes directory and Athena preference volume.
   Use a copy for the first migration check. An image rollback alone does not
   undo a Hermes database or configuration migration.
3. Keep the same public hostname and browser origin. Browser drafts, recording
   state and permissions belong to that origin; do not clear browser storage.
4. Add the `webapp` configuration from the README to the existing `config.yaml`.
   Set its public URL to Athena's external address. The internal Webapp listener
   remains at port 9120; publish only Athena's port 4174.
5. Mount the previous writable Hermes directory at `/opt/data`. Keep the previous
   Athena preference volume at `/data/athena`. The Athena supervisor adjusts only
   that preference directory's ownership for the official `hermes` runtime user.
6. Set `ATHENA_PREFERENCES_IDENTITY_URL` to the previous deployment's exact
   `HERMES_GATEWAY_URL` origin. Retain this setting on subsequent upgrades. It
   preserves the account namespace used by preference files and Android push
   bindings; requests still go to the internal official server. Configure the
   same sign-in provider/account to keep its identity. Changing provider creates
   a different account namespace.
7. Start the candidate with port mapping `4174:4174` and an official sign-in
   provider, as shown in the README. The old `HERMES_GATEWAY_URL` environment
   setting no longer chooses a remote gateway inside this image.
8. Check sign-in, profiles, existing conversations, sending a message, drafts,
   attachments, settings sync, PWA refresh and Android reconnect before replacing
   the active deployment. Keep the offline backup and previous images.

Athena's old default-profile owner `web-single` is read as the official `local`
owner without overwriting its rollback value. Existing composer model choices
are copied to the official scope without removing the original keys. Conversation
draft formats and their storage keys remain unchanged.

Shared renderer preferences are imported into the release's preference owner
before renderer stores load. Athena continues syncing its own preferences and
browser layout keys. Older account preference files remain readable by older
clients. A device that still has offline edits can import them when it next opens.

## Rollback

Stop the candidate before restoring another gateway. Restore the offline Hermes
snapshot if the release changed stored data in a way the previous gateway cannot
read. Restore the previous Athena and gateway images and their original mounts,
port mappings and configuration. Keep the preference volume and browser storage.
Do not point the older gateway at a live database being used by the candidate.

PWA refresh still saves drafts and waits for recording, attachments and pending
saves. Replacing the combined container also restarts Hermes, so a container
upgrade is a separate operation from refreshing the UI during an active task.

## Release updates

Resolve an official stable tag, verify its peeled commit, and update all three
`hermes` metadata values in `flake.lock`. Update `hermes-release.json` and the
Dockerfile's base image digest to the image carrying that exact commit. Review
upstream changes before updating compatibility fingerprints. Do not follow
upstream `main` or moving Docker tags for production builds.

Run `pnpm check:official-base`, `pnpm check:upstream`, `pnpm typecheck`,
`pnpm test:foundation`, `pnpm build`, `pnpm check:renderer` and
`pnpm check:compatibility-registry`. Exercise the affected browser workflows and
build the image in GitHub Actions. Feature-branch image builds do not deploy.
Open the change as a PR on `origin`; merge and deployment remain separate actions.
