"""
Lead persistence.

Every inbound call is a lead. This writes what the end-of-call Gemini pass
learned about the caller into the `leads` table, so the business gets a real
pipeline (who called, what they wanted, how promising, what stage) instead of
a raw call log they have to read line by line.

Two things happen here:

1. upsert_lead_from_call — a Postgres function (supabase/011_leads_crm.sql)
   handles the repeat-caller case atomically: a returning number bumps its
   existing lead's call_count and last_contacted_at rather than creating a
   duplicate row. Human-edited names and interests are never overwritten by
   the model; see the COALESCE ordering in that migration.

2. calls.intent backfill — the analytics dashboard has always charted
   calls.intent, but nothing in the pipeline ever wrote that column, so every
   call rendered as "unknown". The same extraction that feeds the lead now
   also fills it in, which quietly fixes that broken chart.

Everything here is best-effort: a failure to save a lead must never break
call teardown, appointment saving, or anything the caller experiences.
"""
import logging
import os

import httpx

log = logging.getLogger("exotel-bridge")

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

# Must match the check constraint in supabase/011_leads_crm.sql. Anything the
# model invents outside this set is coerced to "other" rather than rejected by
# the database — a surprising intent string shouldn't cost us the whole lead.
VALID_INTENTS = {
    "book_appointment", "reschedule", "cancel", "pricing_enquiry",
    "service_enquiry", "location_hours", "complaint", "follow_up",
    "spam_or_wrong_number", "other",
}


def _clean_intent(raw) -> str | None:
    if not raw:
        return None
    v = str(raw).strip().lower().replace(" ", "_").replace("-", "_")
    return v if v in VALID_INTENTS else "other"


def _clean_score(raw) -> int:
    """Clamp to the 0-100 the DB constraint allows. A model returning 'high'
    or 150 shouldn't fail the insert."""
    try:
        n = int(float(raw))
    except (TypeError, ValueError):
        return 0
    return max(0, min(100, n))


async def _headers() -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }


async def _backfill_call_intent(call_id: str, intent: str) -> None:
    """Write the intent onto the call row too. This is what makes the
    existing analytics intent chart show real data instead of 'unknown'."""
    if not call_id or not intent:
        return
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            await c.patch(
                f"{SUPABASE_URL}/rest/v1/calls?id=eq.{call_id}",
                headers={**(await _headers()), "Prefer": "return=minimal"},
                json={"intent": intent},
            )
    except Exception as e:
        log.warning("call intent backfill failed: %s", e)


async def save_lead_from_call(*, tenant_id, phone, name, intent, interest,
                              score, call_id=None) -> str | None:
    """Upsert a lead from a finished call. Returns the lead id, or None.

    Best-effort: never raises."""
    if not (SUPABASE_URL and SUPABASE_KEY):
        return None
    if not tenant_id or not phone:
        return None

    clean_intent = _clean_intent(intent)
    clean_score = _clean_score(score)

    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(
                f"{SUPABASE_URL}/rest/v1/rpc/upsert_lead_from_call",
                headers=await _headers(),
                json={
                    "p_tenant_id": tenant_id,
                    "p_phone":     phone,
                    "p_name":      name,
                    "p_intent":    clean_intent,
                    "p_interest":  interest,
                    "p_score":     clean_score,
                    "p_call_id":   call_id,
                },
            )
        if r.status_code not in (200, 201, 204):
            log.warning("lead upsert %s: %s", r.status_code, r.text[:200])
            return None

        lead_id = None
        try:
            lead_id = r.json()
        except Exception:
            pass

        log.info("lead saved: %s intent=%s score=%s", phone, clean_intent, clean_score)

        # Fix the previously-always-null calls.intent column.
        if call_id and clean_intent:
            await _backfill_call_intent(call_id, clean_intent)

        return lead_id
    except Exception as e:
        log.warning("lead save failed: %s", e)
        return None
