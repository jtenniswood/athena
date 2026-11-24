# Build this optional extension on the matching Hermes gateway release.
ARG HERMES_GATEWAY_IMAGE=nousresearch/hermes-agent@sha256:ef0650d523ee1b5ab32c779acabc446d9936869a9932591553688a62bcf0c42f
FROM ${HERMES_GATEWAY_IMAGE}
WORKDIR /opt/hermes
COPY athena_cron_chat.py gateway/athena_cron_chat.py
COPY cron-delivery.patch /tmp/athena-cron-delivery.patch
RUN git apply --check /tmp/athena-cron-delivery.patch \
 && git apply /tmp/athena-cron-delivery.patch \
 && rm /tmp/athena-cron-delivery.patch
