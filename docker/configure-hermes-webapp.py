"""Apply Compose Webapp settings through the pinned Hermes configuration writer."""

import os
from urllib.parse import urlsplit


def webapp_settings(environment):
    enabled = environment.get("HERMES_WEBAPP_ENABLED", "true").strip().lower()
    if enabled not in {"true", "false", "1", "0", "yes", "no", "on", "off"}:
        raise ValueError("HERMES_WEBAPP_ENABLED must be true or false")
    enabled = enabled in {"true", "1", "yes", "on"}
    if not enabled:
        return {"enabled": False}

    host = environment.get("HERMES_WEBAPP_HOST", "0.0.0.0").strip()
    if not host or any(character.isspace() for character in host):
        raise ValueError("HERMES_WEBAPP_HOST must be a non-empty bind address")
    try:
        port = int(environment.get("HERMES_WEBAPP_PORT", "9120"))
    except ValueError:
        raise ValueError("HERMES_WEBAPP_PORT must be an integer from 1 to 65535") from None
    if not 1 <= port <= 65535:
        raise ValueError("HERMES_WEBAPP_PORT must be an integer from 1 to 65535")

    public_url = environment.get("HERMES_WEBAPP_PUBLIC_URL") or environment.get("ATHENA_PUBLIC_URL", "")
    public_url = public_url.strip()
    parsed = urlsplit(public_url)
    # Accessing port also rejects malformed ports without echoing the URL.
    try:
        parsed.port
        valid = parsed.scheme in {"http", "https"} and parsed.hostname and not (
            parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in {"", "/"} or any(character.isspace() for character in public_url)
        )
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("Set HERMES_WEBAPP_PUBLIC_URL to the HTTP(S) origin used to open Athena")
    return {"enabled": True, "host": host, "port": port, "public_url": public_url.rstrip("/")}


def configure(environment=None):
    # Validate the complete override before changing any persisted settings.
    settings = webapp_settings(os.environ if environment is None else environment)
    from hermes_cli.config import load_config, set_config_value

    for key, value in settings.items():
        text = str(value).lower() if isinstance(value, bool) else str(value)
        set_config_value("webapp." + key, text)
    applied = load_config().get("webapp", {})
    if any(applied.get(key) != value for key, value in settings.items()):
        raise RuntimeError("Hermes did not accept the Webapp settings; check its configuration management policy")


if __name__ == "__main__":
    try:
        configure()
    except (ValueError, RuntimeError) as error:
        raise SystemExit(str(error)) from None
