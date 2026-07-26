"""
WhatsApp integration (Meta Cloud API).

STATUS: wired and waiting. This module is COMPLETE code but INERT until three
environment variables are set:
    WHATSAPP_PHONE_NUMBER_ID   — from Meta dashboard, WhatsApp → API Setup
    WHATSAPP_ACCESS_TOKEN      — a permanent token for your WABA
    WHATSAPP_CONFIRM_TEMPLATE  — name of your Meta-APPROVED confirmation template

Until those exist, is_enabled() returns False and every send is a logged
no-op. Nothing breaks; appointments still save. The moment you add the vars
and restart, confirmations start flowing. No code change, no redeploy of
logic — just config. This is the same "ready adapter" pattern as Plivo.

WHY TEMPLATES, NOT FREE TEXT
Meta only allows free-form WhatsApp messages inside a 24-hour window that
opens when the CUSTOMER messages YOU first. An appointment confirmation goes
out right after a *phone* call — the customer has not messaged your WhatsApp,
so no window is open. That means confirmations MUST use a pre-approved
"utility" template. You create it once in WhatsApp Manager, Meta reviews it
(24–48h), and then this module fills its {{1}}, {{2}}... placeholders.

Recommended template (category: UTILITY) — create this in WhatsApp Manager:
    Name:  appointment_confirmation
    Body:  "Hi {{1}}, your appointment for {{2}} on {{3}} at {{4}} is
            confirmed. Reply here if you need to reschedule."
    → {{1}}=name  {{2}}=service  {{3}}=date  {{4}}=time
The parameter ORDER below matches that template. If you word yours
differently, keep the same four params in the same order, or adjust
_confirmation_params() to match.

FAIL-SAFE
Every failure (missing config, network error, Meta rejection) is caught and
logged; none propagate. A missed WhatsApp message must never break call
teardown or appointment saving. Delivery is logged to wa_dispatch_log so the
dashboard can show what was sent.
"""
import logging
import os

import httpx

log = logging.getLogger("exotel-bridge")

WA_PHONE_NUMBER_ID = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "")
WA_ACCESS_TOKEN    = os.getenv("WHATSAPP_ACCESS_TOKEN", "")
WA_CONFIRM_TEMPLATE = os.getenv("WHATSAPP_CONFIRM_TEMPLATE", "appointment_confirmation")
WA_TEMPLATE_LANG   = os.getenv("WHATSAPP_TEMPLATE_LANG", "en")
WA_API_VERSION     = os.getenv("WHATSAPP_API_VERSION", "v21.0")

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")


def is_enabled() -> bool:
    """True only when the credentials needed to actually send exist."""
    return bool(WA_PHONE_NUMBER_ID and WA_ACCESS_TOKEN)


def _normalize_to(number: str) -> str | None:
    """Meta wants digits only, country code included, no '+'. Indian mobiles
    arrive as +91XXXXXXXXXX from the call layer."""
    digits = "".join(ch for ch in (number or "") if ch.isdigit())
    if len(digits) == 10:
        return "91" + digits
    if len(digits) in (11, 12) and digits.startswith("91"):
        return digits
    if len(digits) >= 11:
        return digits
    return None


def _confirmation_params(name, service, slot_date, slot_time) -> list:
    """Body parameters in template order. Empty fields get a sensible word
    rather than a blank, so the message still reads correctly."""
    return [
        {"type": "text", "text": str(name or "there")},
        {"type": "text", "text": str(service or "your appointment")},
        {"type": "text", "text": str(slot_date or "the scheduled date")},
        {"type": "text", "text": str(slot_time or "the scheduled time")},
    ]


async def _log_dispatch(tenant_id, appointment_id, to_number, body, status,
                        provider_msg_id=None, call_id=None):
    if not (SUPABASE_URL and SUPABASE_KEY):
        return
    row = {
        "tenant_id": tenant_id,
        "appointment_id": appointment_id,
        "call_id": call_id,
        "message_type": "confirmation",
        "to_number": to_number,
        "message_body": body,
        "status": status,
        "provider_msg_id": provider_msg_id,
    }
    row = {k: v for k, v in row.items() if v is not None}
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            await c.post(f"{SUPABASE_URL}/rest/v1/wa_dispatch_log",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                         "Content-Type": "application/json", "Prefer": "return=minimal"},
                json=row)
    except Exception as e:
        log.warning("wa dispatch log failed: %s", e)


async def send_appointment_confirmation(*, tenant_id, appointment_id, to_number,
                                        caller_name, service, slot_date, slot_time,
                                        call_id=None) -> bool:
    """Send a WhatsApp confirmation for a booked appointment.

    Returns True if Meta accepted the message. Best-effort: never raises.
    A no-op (returns False) when WhatsApp isn't configured.
    """
    if not is_enabled():
        log.info("whatsapp not configured — skipping confirmation (appointment still saved)")
        return False

    to = _normalize_to(to_number)
    if not to:
        log.info("whatsapp: unusable number %r, skipping", to_number)
        return False

    body_summary = (f"Confirmation to {caller_name or 'caller'}: "
                    f"{service or 'appointment'} on {slot_date} {slot_time}")

    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "template",
        "template": {
            "name": WA_CONFIRM_TEMPLATE,
            "language": {"code": WA_TEMPLATE_LANG},
            "components": [{
                "type": "body",
                "parameters": _confirmation_params(caller_name, service, slot_date, slot_time),
            }],
        },
    }
    url = f"https://graph.facebook.com/{WA_API_VERSION}/{WA_PHONE_NUMBER_ID}/messages"

    try:
        async with httpx.AsyncClient(timeout=12) as c:
            r = await c.post(url,
                headers={"Authorization": f"Bearer {WA_ACCESS_TOKEN}",
                         "Content-Type": "application/json"},
                json=payload)
        if r.status_code in (200, 201):
            msg_id = None
            try:
                msg_id = r.json().get("messages", [{}])[0].get("id")
            except Exception:
                pass
            await _log_dispatch(tenant_id, appointment_id, to, body_summary,
                                "sent", msg_id, call_id)
            log.info("whatsapp confirmation sent to %s (msg=%s)", to, msg_id)
            return True
        else:
            # Meta returns descriptive JSON errors — log enough to diagnose
            # (e.g. template not approved, number not on WhatsApp) without
            # dumping the token.
            log.warning("whatsapp send failed %s: %s", r.status_code, r.text[:300])
            await _log_dispatch(tenant_id, appointment_id, to, body_summary, "failed")
            return False
    except Exception as e:
        log.warning("whatsapp send errored: %s", e)
        await _log_dispatch(tenant_id, appointment_id, to, body_summary, "failed")
        return False
