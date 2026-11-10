"""Run inside an extended Hermes image with no network or account credentials."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def until(check, timeout=40):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(0.25)
    raise AssertionError(f"Timed out waiting for {check.__name__}")


def request(path, *, method="GET", body=None):
    base = "http://127.0.0.1:9119"
    headers = {
        "X-Hermes-Session-Token": "athena-cron-smoke",
        "Content-Type": "application/json",
        "Origin": base,
    }
    data = json.dumps(body).encode() if body is not None else None
    with urlopen(Request(base + path, data=data, headers=headers, method=method), timeout=75) as response:
        return json.load(response)


def ready():
    try:
        return request("/api/status")
    except (URLError, TimeoutError):
        return None


def recents():
    return request("/api/profiles/sessions/sidebar")["recents"]["sessions"]


def reports(session_id):
    return request(f"/api/sessions/{session_id}/messages")["messages"]


def trigger(job):
    run = request(f"/api/cron/jobs/{job['id']}/trigger", method="POST")
    assert run["last_status"] == "ok", run


def run():
    choices = request("/api/cron/delivery-targets")["targets"]
    assert any(choice["id"] == "dedicated-chat" and choice["name"] == "Create dedicated chat" for choice in choices)
    jobs = [
        request("/api/cron/jobs", method="POST", body={
            "name": name, "deliver": "dedicated-chat", "schedule": "0 0 1 1 *",
            "script": "report.sh", "no_agent": True,
        })
        for name in ("Daily report", "Weekly report")
    ]
    assert not recents()

    trigger(jobs[0])
    first = until(recents)[0]
    assert first["title"] == "Daily report", first
    assert first["profile"] == "default", first
    session_id = first["id"]
    snapshot = request(f"/api/sessions/{session_id}/mutation-snapshot")
    request(f"/api/sessions/{session_id}", method="PATCH", body={
        "title": "Renamed daily report", "request_id": "smoke-rename",
        "expected_revision": snapshot["runtime_revision"],
        "expected_generation": snapshot["runtime_generation"],
    })

    trigger(jobs[0])
    trigger(jobs[1])
    rows = until(lambda: len(recents()) == 2 and recents())
    by_title = {row["title"]: row["id"] for row in rows}
    assert set(by_title) == {"Renamed daily report", "Weekly report"}, rows
    assert by_title["Renamed daily report"] == session_id
    for sid, count in [(session_id, 2), (by_title["Weekly report"], 1)]:
        notes = until(lambda: len(reports(sid)) == count and reports(sid))
        assert all(note["content"] == "Scheduled smoke result" for note in notes), notes


with tempfile.TemporaryDirectory(prefix="athena-cron-smoke-") as directory:
    home = Path(directory)
    (home / "config.yaml").write_text("webapp:\n  enabled: true\n  bind: 127.0.0.1\n  port: 9120\n")
    (home / "scripts").mkdir()
    (home / "scripts/report.sh").write_text("#!/bin/sh\nprintf '%s\\n' 'Scheduled smoke result'\n")
    (home / "scripts/report.sh").chmod(0o700)
    env = {**os.environ, "HERMES_HOME": directory, "HERMES_DESKTOP": "1",
           "HERMES_DASHBOARD_SESSION_TOKEN": "athena-cron-smoke"}
    with (home / "server.log").open("w+") as log:
        gateway = subprocess.Popen(
            ["hermes", "gateway", "run", "--force", "--no-supervise"],
            env=env, stdout=log, stderr=subprocess.STDOUT,
        )
        server = subprocess.Popen(
            ["hermes", "serve", "--host", "127.0.0.1", "--port", "9119", "--skip-build"],
            env=env, stdout=log, stderr=subprocess.STDOUT,
        )
        try:
            until(ready)
            until(lambda: (home / "state.db").exists())
            run()
        except HTTPError as error:
            print(error.read().decode())
            raise
        finally:
            server.terminate()
            gateway.terminate()
            try:
                server.wait(timeout=15)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
            gateway.wait(timeout=15)
            log.seek(0)
            print(log.read())
    print("Dedicated cron chat smoke test passed.")
