"""Deliver cron output into a regular, profile-owned Hermes chat."""

import asyncio
import json
from functools import partial

DEDICATED_CHAT = "dedicated-chat"


def _title_if_empty(db, session_id, name):
    # Hermes reserves titles across chats. Keep the job's name where possible
    # and use the session ID for a stable disambiguator if another chat has it.
    def write(conn):
        current = conn.execute("SELECT title FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if current is None or current["title"]:
            return
        title = db.sanitize_title(name[:db.MAX_TITLE_LENGTH]) or "Scheduled task"
        held = conn.execute("SELECT 1 FROM sessions WHERE title = ?", (title,)).fetchone()
        if held or title == db.CANONICAL_BOT_CHAT_TITLE:
            suffix = f" ({session_id[-12:]})"
            title = title[:db.MAX_TITLE_LENGTH - len(suffix)].rstrip() + suffix
        db._set_session_title_in_transaction(conn, session_id, title, source=db.TITLE_SOURCE_USER)

    db._execute_write(write)


async def _admit(authority, job_id, name, execution_id, text, diagnostic):
    from gateway.owner_identity import host_owner_subject
    from gateway.session_authorities import owner_scope
    from gateway.session_contract import SessionActor
    from gateway.session_cron import _admit_local_delivery
    from gateway.session_local import stage_local_session
    from gateway.session_runtime_workers import tracked_write
    from hermes_cli.anon_auth import GUEST_MODEL
    from hermes_state_keys import local_identity
    from hermes_state_local import commit_local_session

    # The profile and immutable job ID identify the conversation, including
    # across gateway restarts, concurrent first deliveries and chat renames.
    request_id = f"athena:cron-delivery:{job_id}"
    actor = SessionActor(host_owner_subject(), authority.profile_id,
                         frozenset({"session:create"}), "athena-cron")
    session_id = local_identity(authority.profile_id, actor.subject, request_id)
    with owner_scope(authority):
        if authority.db.get_session(session_id) is None:
            params = {"request_id": request_id, "source": "gui", "follow_profile_config": True}
            receipt = stage_local_session(authority, actor, params)
            if isinstance(receipt, dict):
                # A script-only job can deliver before any model is configured.
                # A valid receipt needs a model and the chat follows the profile's
                # actual selection when it is configured later.
                receipt["policy"]["model"] = receipt["policy"]["model"] or GUEST_MODEL
                await tracked_write(authority, partial(
                    commit_local_session, authority.db, epoch=authority.epoch, receipt=receipt))
        await tracked_write(authority, partial(_title_if_empty, authority.db, session_id, name))
        identity = json.dumps(["cron", "dedicated-chat", job_id, execution_id, diagnostic],
                              separators=(",", ":"))
        metadata = {"notification_category": "diagnostic"} if diagnostic else {}
        return await _admit_local_delivery(authority, session_id, text, metadata, identity=identity)


def deliver_to_dedicated_chat(job_id, name, execution_id, text, *, diagnostic=False):
    """Submit a note to the gateway's existing durable session FIFO."""
    from gateway.session_cron import owner_for_home
    from hermes_constants import get_hermes_home
    from hermes_state_runtime import RuntimeStoreError

    if not execution_id:
        return "Dedicated chat delivery requires a cron execution ID"
    owner = owner_for_home(get_hermes_home())
    if owner is None:
        return "Dedicated chat delivery requires the job profile's gateway"
    authority, loop = owner
    try:
        admitted = asyncio.run_coroutine_threadsafe(
            _admit(authority, job_id, name, execution_id, text, diagnostic), loop).result(timeout=60)
    except (ValueError, KeyError, TimeoutError) as error:
        reason = error.reason if isinstance(error, RuntimeStoreError) else type(error).__name__
        return f"Dedicated chat delivery could not be confirmed ({reason})"
    return None if admitted else "Dedicated chat refused the delivery"
