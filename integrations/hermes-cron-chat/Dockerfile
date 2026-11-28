# Build this optional extension on the matching Hermes gateway release.
ARG HERMES_GATEWAY_IMAGE=nousresearch/hermes-agent@sha256:bc79a80fc9cb97521f4380c5d5b2ad88e2469e50fc1d5027339bbb42cc206854
FROM ${HERMES_GATEWAY_IMAGE}
WORKDIR /opt/hermes
COPY athena_cron_chat.py gateway/athena_cron_chat.py
COPY cron-delivery.patch /tmp/athena-cron-delivery.patch
RUN git apply --check /tmp/athena-cron-delivery.patch \
 && git apply /tmp/athena-cron-delivery.patch \
 && rm /tmp/athena-cron-delivery.patch
