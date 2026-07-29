"""
Outbound call dispatch via Exotel's "Connect Number to a Call Flow" API.
Calls the recipient's number, and once they answer, connects them to the
SAME Voicebot Applet flow already used for inbound calls — no new
WebSocket endpoint needed. bridge.py's existing /ws/exotel handler
receives outbound-originated calls exactly like inbound ones; see
correlate_outbound_call() for how it tells the two apart.

Correlation design: Exotel's CustomField parameter is documented as being
passed to Passthru/Greeting applets via a GET request — it is NOT
confirmed whether it threads through to a Voicebot Applet's WebSocket
`start` event the same way. Rather than guess and risk silent
correlation failures on a real (costly, regulated) call, this stores the
Exotel-returned CallSid on the outbound_recipients row at dispatch time,
then looks it up by that CallSid when the call connects — CallSid is
guaranteed present in the start event, already relied on for inbound
calls today.

HARD BLOCKERS — this module cannot be exercised end-to-end until:
  1. Exotel has explicitly enabled outbound calling on the account. Per
     Exotel's own docs, this is NOT available by default (especially on
     a trial account) and requires contacting hello@exotel.com or your
     account manager.
  2. EXOTEL_OUTBOUND_APP_ID is set to the real numeric app_id of the
     existing Voicebot Applet flow, found in the Exotel Dashboard when
     editing that flow. Not guessable — genuinely account-specific data.
  3. EXOTEL_API_KEY / EXOTEL_API_TOKEN / EXOTEL_ACCOUNT_SID /
     EXOTEL_CALLER_ID are set in the pipeline's environment (currently
     not present anywhere in the deployed config — confirmed by
     inspecting the live supervisor conf).

None of the above are code problems. The code below is real and tested
(with mocks) up to the point where it would make the actual Exotel API
call — that specific call cannot be verified without real credentials,
a real enabled account, and, ultimately, spending real trial credits on
one deliberate test call.
"""
import logging
import os

import httpx

log = logging.getLogger("exotel-bridge")

EXOTEL_API_KEY = os.getenv("EXOTEL_API_KEY", "")
EXOTEL_API_TOKEN = os.getenv("EXOTEL_API_TOKEN", "")
EXOTEL_ACCOUNT_SID = os.getenv("EXOTEL_ACCOUNT_SID", "")
# Singapore cluster (confirmed account region as of 2026-07-02). Mumbai
# cluster would be api.in.exotel.com — only relevant if the account is
# ever migrated to India region.
EXOTEL_SUBDOMAIN = os.getenv("EXOTEL_SUBDOMAIN", "api.exotel.com")
EXOTEL_OUTBOUND_APP_ID = os.getenv("EXOTEL_OUTBOUND_APP_ID", "")
EXOTEL_CALLER_ID = os.getenv("EXOTEL_CALLER_ID", "")  # which ExoPhone to dial from

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")


def config_status() -> dict:
    """Which of the required env vars are actually set — lets a health
    check or the dispatch endpoint give a precise "here's what's still
    missing" answer instead of a generic failure."""
    required = {
        "EXOTEL_API_KEY": bool(EXOTEL_API_KEY),
        "EXOTEL_API_TOKEN": bool(EXOTEL_API_TOKEN),
        "EXOTEL_ACCOUNT_SID": bool(EXOTEL_ACCOUNT_SID),
        "EXOTEL_OUTBOUND_APP_ID": bool(EXOTEL_OUTBOUND_APP_ID),
        "EXOTEL_CALLER_ID": bool(EXOTEL_CALLER_ID),
    }
    return {"ready": all(required.values()), "fields": required}


async def place_outbound_call(to_number: str, status_callback: str = None,
                               time_limit: int = None) -> dict:
    """Places one outbound call via Exotel's Calls/connect API. Returns
    {"success": bool, "call_sid": str|None, "error": str|None} — never
    raises. A failed dispatch (busy, no-answer, invalid number, account
    not enabled for outbound) is a normal, expected outcome the caller
    must handle gracefully, not an exceptional program state."""
    status = config_status()
    if not status["ready"]:
        missing = [k for k, v in status["fields"].items() if not v]
        return {"success": False, "call_sid": None,
                "error": f"Exotel outbound config incomplete, missing: {', '.join(missing)}"}

    url = f"https://{EXOTEL_SUBDOMAIN}/v1/Accounts/{EXOTEL_ACCOUNT_SID}/Calls/connect.json"
    flow_url = f"http://my.exotel.com/{EXOTEL_ACCOUNT_SID}/exoml/start_voice/{EXOTEL_OUTBOUND_APP_ID}"

    data = {
        "From": to_number,             # who gets called FIRST — our recipient
        "CallerId": EXOTEL_CALLER_ID,  # our ExoPhone
        "Url": flow_url,               # connects to the same Voicebot Applet as inbound
        "CallType": "trans",
    }
    if time_limit:
        data["TimeLimit"] = str(time_limit)
    if status_callback:
        data["StatusCallback"] = status_callback

    async with httpx.AsyncClient(timeout=15, auth=(EXOTEL_API_KEY, EXOTEL_API_TOKEN)) as c:
        try:
            r = await c.post(url, data=data)
        except Exception as e:
            log.error("outbound dispatch failed: %s", e)
            return {"success": False, "call_sid": None, "error": str(e)}

        if r.status_code != 200:
            log.error("outbound dispatch %s: %s", r.status_code, r.text[:300])
            return {"success": False, "call_sid": None,
                    "error": f"HTTP {r.status_code}: {r.text[:200]}"}

        try:
            call_sid = r.json()["Call"]["Sid"]
            log.info("outbound call placed: sid=%s to=%s", call_sid, to_number)
            return {"success": True, "call_sid": call_sid, "error": None}
        except (KeyError, ValueError, TypeError) as e:
            log.error("outbound dispatch: unexpected response shape: %s", r.text[:300])
            return {"success": False, "call_sid": None, "error": f"unexpected response: {e}"}


async def mark_recipient_dispatched(recipient_id: str, call_sid: str) -> None:
    """Best-effort — a failure here must not un-place a call that's
    already ringing. Correlation still works via exotel_call_sid even if
    this particular write is retried or lost."""
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            await c.patch(
                f"{SUPABASE_URL}/rest/v1/outbound_recipients?id=eq.{recipient_id}",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                         "Content-Type": "application/json", "Prefer": "return=minimal"},
                json={"status": "in_progress", "exotel_call_sid": call_sid},
            )
    except Exception as e:
        log.warning("mark_recipient_dispatched failed: %s", e)


async def mark_recipient_failed(recipient_id: str, error: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            await c.patch(
                f"{SUPABASE_URL}/rest/v1/outbound_recipients?id=eq.{recipient_id}",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                         "Content-Type": "application/json", "Prefer": "return=minimal"},
                json={"status": "failed"},
            )
    except Exception as e:
        log.warning("mark_recipient_failed failed: %s", e)
    log.warning("outbound recipient %s failed: %s", recipient_id, error)


async def correlate_outbound_call(call_sid: str) -> dict:
    """Called from bridge.py's start handler for EVERY connected call
    (inbound or outbound) — checks whether this call_sid matches a
    dispatched outbound recipient. Returns None if not (the normal case
    for inbound calls, which fall through to the existing DID-based
    lookup unchanged). Returns the recipient+campaign context dict if it
    IS a match.

    Never raises — a lookup failure here must not break call handling;
    worst case, an outbound call gets treated as inbound and falls back
    to the generic demo greeting instead of its script, which is a
    degraded experience, not a crash."""
    if not call_sid:
        return None
    async with httpx.AsyncClient(timeout=8) as c:
        try:
            r = await c.get(f"{SUPABASE_URL}/rest/v1/outbound_recipients",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
                params={"exotel_call_sid": f"eq.{call_sid}", "limit": "1",
                        "select": "id,campaign_id,tenant_id,phone,first_name,"
                                  "outbound_campaigns(script,voice_profile_id)"})
            if r.status_code != 200:
                return None
            rows = r.json()
            if not rows:
                return None
            return rows[0]
        except Exception as e:
            log.warning("correlate_outbound_call failed: %s", e)
            return None


async def mark_recipient_status(recipient_id: str, status: str):
    """Best-effort status update on the recipient row — dashboard/stats
    visibility, never worth failing a call over."""
    async with httpx.AsyncClient(timeout=5) as c:
        try:
            await c.patch(f"{SUPABASE_URL}/rest/v1/outbound_recipients",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                         "Content-Type": "application/json"},
                params={"id": f"eq.{recipient_id}"},
                json={"status": status})
        except Exception:
            pass
