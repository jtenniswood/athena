"""Start Athena's extensions alongside the official supervised Hermes runtime."""
import os
import sys

from hermes_cli.config import load_config_readonly

config = load_config_readonly().get("webapp") or {}
if not config.get("enabled"):
    sys.exit("Athena needs webapp.enabled: true in the mounted Hermes config.yaml.")
host = str(config.get("host") or "127.0.0.1")
if host in ("0.0.0.0", "::"):
    host = "127.0.0.1" if host == "0.0.0.0" else "[::1]"
elif ":" in host and not host.startswith("["):
    host = f"[{host}]"
port = int(config.get("port") or 9120)
env = {**os.environ, "HERMES_GATEWAY_URL": f"http://{host}:{port}"}
public_url = config.get("public_url")
if public_url:
    env["ATHENA_PUBLIC_URL"] = str(public_url)
os.execvpe("node", ["node", "/opt/athena/apps/web-desktop/server/official-main.mjs"], env)
