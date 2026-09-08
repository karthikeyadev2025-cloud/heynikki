# The HeyNikki API

Reference for the public REST API. The customer-facing version of this
document is the `/developers` page on the site (`web/app/developers/page.tsx`);
if you change one, change the other.

Base URL: `https://api.heynikki.in`

## Authentication

Bearer key, issued from the dashboard's API keys page
(`POST /api/keys/mine`, gated on `planAllows(tenant, "api_access")`).
`verifyApiKey` (api-server/src/index.ts) looks the key up by its 12-character
prefix and bcrypt-compares; `requireScope(...)` gates each route.

Scopes — the list lives in one place, `API_SCOPES` in index.ts, and the
dashboard's `AVAILABLE_SCOPES` mirrors it:

| Scope | Grants |
|---|---|
| `calls.read` | `GET /api/v1/calls`, `/calls/:id`, `/calls/outbound`, `/calls/outbound/:id` |
| `calls.write` | `POST /api/v1/calls/outbound`, `DELETE /api/v1/calls/outbound/:id` |
| `appointments.read` | `GET /api/v1/appointments` |
| `orders.read` | `GET /api/v1/orders`, `/orders/:id` |
| `orders.write` | `PATCH /api/v1/orders/:id` |

Rate limit: 100 requests per minute per key (`publicApiLimiter`).

## Outbound calls

`POST /api/v1/calls/outbound` writes an **instant `outbound_recipients` row**
(`is_instant = true`, `campaign_id = null`, `metadata.source = "api_reminder"`).
Nothing else about the outbound path changes: `tickInstant()` in
`jobs/outbound-dispatcher.ts` picks it up within 30 seconds inside
09:00–20:30 IST, `dispatchCall` originates it, the hangup hook closes it.

Three things had to be added for the API path:

1. **Consent.** `tickInstant` now treats `consent_declared` as consent
   alongside `consent_call_id` and the tenant's `skip_dnd_for_instant_leads`
   flag. The API refuses a request without `consent: true`, so a row carrying
   the flag has an attestation on the record. The column is added by
   migration 048 — 019 put the same three columns on `outbound_campaigns`,
   where consent describes an uploaded list rather than one call.
2. **The recipient id reaches the pipeline.** `originateOutbound` takes a
   `recipientId` and sets the `recipient_id` channel variable; the dialplan
   (`infra/freeswitch/conf/dialplan/heynikki.xml`) appends `&recipient=` to
   the websocket URL. It could not be looked up by channel UUID instead:
   the dispatcher writes `metadata.fs_uuid` only *after* originate returns,
   which is after the pipeline is already speaking.
3. **The result.** `_report_reminder_result` in the pipeline reads the
   transcript after the call and writes `metadata.result`
   (`delivered`, `customer_response`, `note`) — because a call that connected
   is not a message that landed.

### Callbacks

`api-server/src/api-callbacks.ts` owns the payload and its signature, and is
called from two places: the dispatcher, immediately, when a call could not be
placed at all (trunk failure, DND block); and the hangup hook, ~12 s after the
channel ends, so the pipeline's verdict is already on the row.

Delivery is at-least-once with a 0/15 s/1 min/5 min ladder, stopping early on
a 4xx that is not 408/429. `metadata.callback_delivered_at` makes a repeat
call to `notifyApiCallback` a no-op.

Signature: `X-Nikki-Signature: sha256=<hex HMAC-SHA256 of the raw body>` using
`callback_secret`. Sent only when the caller supplied a secret.

## Orders

Migration `supabase/047_api_outbound_and_orders.sql` adds `public.orders` and
two `voice_profiles` columns, `order_taking` and `catalogue`.

The flow, all of it inside code that already existed:

- `build_system_prompt` gains `_order_block(profile)` — the catalogue, its
  prices, and the six steps of taking an order — only when `order_taking` is
  on. Prefill on the caller's critical path, so it is absent for everyone else.
- `_detect_intent` gains order words, gated on the same flag: "delivery time"
  on a clinic's line is not an order. `agent.order_seen` is sticky the way
  `callback_promised` is, and `final_intent()` ranks a filed order above the
  last keyword matched.
- `_extract_order` runs at cleanup, next to `_enrich_appointment`, and files
  the row only when the model says the customer confirmed a read-back **and**
  at least one item survives validation. Unit prices come from the tenant's
  catalogue where the item matches, never from what STT heard.
- Then: `POST /api/whatsapp/order-confirm` (template `order_confirmed`, see
  docs/whatsapp-templates.md — not yet submitted) and the `order-created`
  automation webhook, platform and tenant.

Order references are `ORD-` plus four characters from an alphabet with no
O/0, I/1, S/5 or B/8 — they get read out on the phone.

## Errors

| Status | Meaning |
|---|---|
| 400 | Malformed field; the body names it in `field`. |
| 401 | Missing, malformed, revoked or expired key. |
| 402 | `plan_upgrade_required` — outbound calling is not on this plan. |
| 403 | Valid key, missing scope; the body lists `required` and `granted`. |
| 409 | `opted_out`, `duplicate`, `no_number`, or a call already being dialled. |
| 429 | Rate limited. |
