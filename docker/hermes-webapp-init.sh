#!/command/with-contenv sh
set -eu
exec /command/s6-setuidgid hermes /opt/hermes/.venv/bin/python /opt/athena/configure-hermes-webapp.py
