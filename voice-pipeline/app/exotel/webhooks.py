"""
Outbound webhooks — lets a tenant wire Jovio into Zapier, Make, n8n, or
any custom endpoint without needing a named CRM integration built for
them specifically. This is the honest, buildable version of "CRM
integration": instead of guessing which specific CRM to prioritize
(Salesforce? HubSpot? something else?), any tenant can point ANY tool
that accepts webhooks at Jovio.

Scope, deliberately limited to what's real: only `call.completed` fires
today. There is currently no appointment-booking step anywhere in the
live pipeline — Gemini can SAY it booked an appointment in conversation,
but no appointment record is ever created anywhere. An
`appointment.created` webhook would fire an event that never actually
happens, so it isn't built here. When real appointment extraction/booking
exists as a pipeline step, add that event then, not before.

Delivery: fire-and-forget, best-effort. A webhook failure must NEVER
block or delay call teardown — this always runs after the call has
already been finalized in the database, never in the critical path.

Signing: HMAC-SHA256 over the raw JSON body, sent as
`X-Jovio-Signature: sha256=<hex>`, using the tenant's own per-webhook
secret (generated when they create the webhook config, never chosen by
Jovio). Lets the receiving end (Zapier's "Webhooks by Zapier", a custom
endpoint, whatever) verify the payload genuinely came from Jovio and
wasn't spoofed by a third party who found the URL.
"""
import hashlib
import hmac
import json
import logging
import os
import time

import httpx

log = logging.getLogger("exotel-bridge")

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")


def _sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


async def _get_active_webhooks(tenant_id: str, event: str) -> list:
    """Active webhook configs for this tenant subscribed to this event.
    Empty list on any failure — a lookup failure must never block call
    teardown, which is what always calls this."""
    if not tenant_id or tenant_id == "unmatched":
        return []
    async with httpx.AsyncClient(timeout=8) as c:
        try:
            r = await c.get(f"{SUPABASE_URL}/rest/v1/webhook_configs",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
                params={"tenant_id": f"eq.{tenant_id}", "active": "eq.true",
                        "select": "id,url,secret,events"})
            if r.status_code != 200:
                return []
            return [w for w in r.json() if event in (w.get("events") or [])]
        except Exception as e:
            log.warning("webhooks: lookup failed: %s", e)
            return []


async def _mark_fired(webhook_id: str, status_code: int):
    """Best-effort bookkeeping for the dashboard to show 'last fired' /
    'last status' — purely informational, never worth failing over."""
    async with httpx.AsyncClient(timeout=5) as c:
        try:
            await c.patch(f"{SUPABASE_URL}/rest/v1/webhook_configs",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                         "Content-Type": "application/json"},
                params={"id": f"eq.{webhook_id}"},
                json={"last_fired_at": "now()", "last_status_code": status_code})
        except Exception:
            pass


async def dispatch_event(tenant_id: str, event: str, payload: dict):
    """Fire this event to every active webhook this tenant has configured
    for it. Fully best-effort — every exception is caught and logged,
    never raised, since this always runs after the real work is done."""
    try:
        webhooks = await _get_active_webhooks(tenant_id, event)
        if not webhooks:
            return
        body = {"event": event, "timestamp": int(time.time()), "data": payload}
        body_bytes = json.dumps(body).encode()

        async with httpx.AsyncClient(timeout=10) as c:
            for w in webhooks:
                signature = _sign(w["secret"], body_bytes)
                try:
                    r = await c.post(w["url"], content=body_bytes,
                        headers={
                            "Content-Type": "application/json",
                            "X-Jovio-Event": event,
                            "X-Jovio-Signature": f"sha256={signature}",
                        })
                    log.info("webhook dispatched: event=%s url=%s status=%d",
                              event, w["url"], r.status_code)
                    await _mark_fired(w["id"], r.status_code)
                except Exception as e:
                    log.warning("webhook dispatch failed: event=%s url=%s error=%s",
                                event, w["url"], e)
    except Exception as e:
        log.warning("dispatch_event failed entirely: %s", e)
