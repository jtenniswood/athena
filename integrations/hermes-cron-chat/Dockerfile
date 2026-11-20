# Build this optional extension on the matching Hermes gateway release.
ARG HERMES_GATEWAY_IMAGE=nousresearch/hermes-agent@sha256:3e9fe4c6ef36490f43aa0d0d80f9df64e9c92a576eee3042f1a97c8813c05355
FROM ${HERMES_GATEWAY_IMAGE}
WORKDIR /opt/hermes
COPY athena_cron_chat.py gateway/athena_cron_chat.py
COPY cron-delivery.patch /tmp/athena-cron-delivery.patch
RUN git apply --check /tmp/athena-cron-delivery.patch \
 && git apply /tmp/athena-cron-delivery.patch \
 && rm /tmp/athena-cron-delivery.patch
