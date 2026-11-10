# Build this optional extension on the matching Hermes gateway release.
ARG HERMES_GATEWAY_IMAGE=nousresearch/hermes-agent@sha256:276d44685c65c0cb2a25f190b63c65c8906f9dc76486fb1c05ae71b5826bda08
FROM ${HERMES_GATEWAY_IMAGE}
WORKDIR /opt/hermes
COPY athena_cron_chat.py gateway/athena_cron_chat.py
COPY cron-delivery.patch /tmp/athena-cron-delivery.patch
RUN git apply --check /tmp/athena-cron-delivery.patch \
 && git apply /tmp/athena-cron-delivery.patch \
 && rm /tmp/athena-cron-delivery.patch
