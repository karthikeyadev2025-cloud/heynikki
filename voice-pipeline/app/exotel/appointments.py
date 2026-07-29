"""
Appointment extraction.

The honesty gap this closes: the receptionist prompt tells Nikki to "collect
name, phone, time" and confirm appointments, and she DOES say she's booked
them on the call — but until now nothing was ever written to the
appointments table. The AI claimed to book; the business got no record. A
caller who was told "booked for 10:30 tomorrow" would show up to a clinic
that had no idea they were coming.

Design: extraction runs ONCE at call end over the full transcript, not
per-turn. Rationale --
  - Accuracy: the whole conversation is available, so a time mentioned early
    and confirmed late is captured correctly. Per-turn extraction would fire
    on half-information.
  - Latency: appointment extraction must NEVER add delay to a live turn. At
    call end the caller has already hung up, so a 1-2s Gemini call costs
    nothing experientially.
  - Cost: one extra Gemini call per call that actually contained a booking,
    vs one per turn.

Fail-safe: if extraction fails, errors, or the model returns anything
unparseable, we log and write NOTHING. A missed appointment record is
recoverable (the call recording and transcript still exist); a WRONG
appointment record (garbage date, hallucinated name) actively misleads the
business. When unsure, extract nothing.
"""
import json
import logging
import os
import re

import httpx

from app.exotel import whatsapp
from app.exotel import leads

log = logging.getLogger("exotel-bridge")

GEMINI_KEY = os.getenv("GEMINI_API_KEY", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

_EXTRACT_PROMPT = """You are analysing a phone call transcript between an AI receptionist and a caller.

Determine whether an appointment/booking was actually AGREED during this call.

Return ONLY a JSON object, no other text, in exactly this shape:
{{"booked": true/false, "caller_name": string or null, "service": string or null, "slot_date": "YYYY-MM-DD" or null, "slot_time": string or null, "notes": string or null, "intent": string, "interest": string or null, "score": number}}

Rules:
- "booked" is true ONLY if a specific appointment was confirmed by both sides. A caller merely asking about availability, or saying "I'll think about it", is NOT booked.
- slot_date must be an absolute date in YYYY-MM-DD form. Convert relative dates ("tomorrow", "next Monday") using the call date provided below. If no date was actually settled, use null.
- slot_time: keep the caller's phrasing ("10:30 AM", "morning"). null if not settled.
- Never invent details. If something wasn't stated, it's null.
- If in doubt about whether a real booking happened, return "booked": false.

For the lead fields (these describe the CALLER, and are filled in for EVERY call, booked or not):
- "intent": one of exactly these values, whichever fits best:
  "book_appointment", "reschedule", "cancel", "pricing_enquiry",
  "service_enquiry", "location_hours", "complaint", "follow_up",
  "spam_or_wrong_number", "other"
- "interest": short phrase for the specific service/product they asked about, or null.
- "score": 0-100, how promising this caller is as business:
  80-100 = booked or explicitly ready to buy
  50-79  = serious enquiry, asked about price/availability, likely to return
  20-49  = general enquiry, early interest
  0-19   = wrong number, spam, or no business intent

Call date (today): {call_date}

Transcript:
{transcript}
"""


async def _gemini_extract(transcript_text: str, call_date: str) -> dict | None:
    """One Gemini pass. Returns parsed dict or None on any failure."""
    url = ("https://generativelanguage.googleapis.com/v1beta/models/"
           "gemini-2.5-flash:generateContent?key=" + GEMINI_KEY)
    prompt = _EXTRACT_PROMPT.format(call_date=call_date, transcript=transcript_text)
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post(url,
                headers={"Content-Type": "application/json"},
                json={"contents": [{"role": "user", "parts": [{"text": prompt}]}],
                      "generationConfig": {
                          "temperature": 0,           # deterministic extraction
                          "maxOutputTokens": 400,
                          "thinkingConfig": {"thinkingBudget": 0},
                      }})
        if r.status_code != 200:
            log.warning("appointment extract: gemini %s", r.status_code)
            return None
        parts = r.json()["candidates"][0]["content"]["parts"]
        raw = " ".join(p["text"] for p in parts if p.get("text") and not p.get("thought")).strip()
        # Model sometimes wraps JSON in ```json fences despite instructions.
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if not m:
            log.info("appointment extract: no JSON in response")
            return None
        return json.loads(m.group(0))
    except Exception as e:
        log.warning("appointment extract failed: %s", e)
        return None


async def _insert_appointment(row: dict) -> bool:
    async with httpx.AsyncClient(timeout=8) as c:
        try:
            r = await c.post(f"{SUPABASE_URL}/rest/v1/appointments",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                         "Content-Type": "application/json", "Prefer": "return=representation"},
                json=row)
            if r.status_code in (200, 201, 204):
                # return=representation gives back the inserted row(s), so we
                # can hand the new id to the WhatsApp confirmation step.
                try:
                    data = r.json()
                    if isinstance(data, list) and data:
                        return data[0].get("id") or True
                except Exception:
                    pass
                return True
            log.warning("appointment insert %s: %s", r.status_code, r.text[:200])
            return None
        except Exception as e:
            log.warning("appointment insert failed: %s", e)
            return None


async def extract_and_save(session, call_date: str):
    """Called at call end. Best-effort — never raises, never blocks anything
    important, writes nothing unless a real booking is found.

    `session` is the bridge Session; we read .history, .tenant, .caller,
    .voice_profile_id, .call_row_id off it."""
    try:
        history = getattr(session, "history", []) or []
        # Need at least a couple of exchanges for a booking to be possible.
        if len(history) < 3:
            return

        tenant = getattr(session, "tenant", {}) or {}
        tenant_id = tenant.get("id")
        if not tenant_id or tenant_id == "unmatched":
            return  # demo/unmatched calls don't create real records

        transcript_text = "\n".join(
            f"{'Caller' if m['role'] == 'user' else 'Nikki'}: {m['content']}"
            for m in history
        )

        result = await _gemini_extract(transcript_text, call_date)
        if not result:
            return

        caller_number = getattr(session, "caller", "") or ""
        call_id = getattr(session, "call_row_id", None)

        # ── LEAD: saved for EVERY call, booked or not ──
        # This runs before the appointment branch and independently of it:
        # a caller who asked about prices and didn't book is still a lead the
        # business wants to see. Spam / wrong numbers score low and sort to
        # the bottom rather than being hidden, so nothing is silently lost.
        if caller_number:
            try:
                await leads.save_lead_from_call(
                    tenant_id=tenant_id,
                    phone=caller_number,
                    name=result.get("caller_name"),
                    intent=result.get("intent"),
                    interest=result.get("interest") or result.get("service"),
                    score=result.get("score"),
                    call_id=call_id,
                )
            except Exception as e:
                log.warning("lead save skipped: %s", e)

        # ── APPOINTMENT: only when a real booking was agreed ──
        if not result.get("booked"):
            return

        row = {
            "tenant_id": tenant_id,
            "voice_profile_id": getattr(session, "voice_profile_id", None),
            "call_id": call_id,
            "caller_name": result.get("caller_name"),
            "caller_number": caller_number or "unknown",
            "service": result.get("service"),
            "slot_date": result.get("slot_date"),
            "slot_time": result.get("slot_time"),
            "notes": result.get("notes"),
            "status": "confirmed",
        }
        # Strip nulls so DB defaults apply cleanly.
        row = {k: v for k, v in row.items() if v is not None}

        saved = await _insert_appointment(row)
        if saved:
            log.info("appointment saved: %s on %s at %s",
                     row.get("caller_name", "?"),
                     row.get("slot_date", "?"),
                     row.get("slot_time", "?"))

            # Fire the WhatsApp confirmation. No-op unless WhatsApp is
            # configured (whatsapp.is_enabled()); never blocks or raises.
            # `saved` is the new appointment id when the insert returned it,
            # else True — pass it through only if it's a real id string.
            appt_id = saved if isinstance(saved, str) else None
            try:
                await whatsapp.send_appointment_confirmation(
                    tenant_id=tenant_id,
                    appointment_id=appt_id,
                    to_number=row.get("caller_number"),
                    caller_name=row.get("caller_name"),
                    service=row.get("service"),
                    slot_date=row.get("slot_date"),
                    slot_time=row.get("slot_time"),
                    call_id=row.get("call_id"),
                )
            except Exception as e:
                log.warning("whatsapp confirmation skipped: %s", e)
    except Exception as e:
        log.warning("extract_and_save failed entirely: %s", e)
