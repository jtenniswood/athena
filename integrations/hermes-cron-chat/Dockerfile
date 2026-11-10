# Build this optional extension on the matching Hermes gateway release.
ARG HERMES_GATEWAY_IMAGE=nousresearch/hermes-agent@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002
FROM ${HERMES_GATEWAY_IMAGE}
WORKDIR /opt/hermes
COPY athena_cron_chat.py gateway/athena_cron_chat.py
COPY cron-delivery.patch /tmp/athena-cron-delivery.patch
RUN git apply --check /tmp/athena-cron-delivery.patch \
 && git apply /tmp/athena-cron-delivery.patch \
 && rm /tmp/athena-cron-delivery.patch
