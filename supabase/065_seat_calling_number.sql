-- ══════════════════════════════════════════════════════════════
-- 065 — a telecaller's own calling number
--
-- 064 let a business choose which of its numbers make outgoing calls; the
-- Desk then spread click-to-calls across them by customer. A business that
-- gives each telecaller a number of their own needs more: that telecaller's
-- calls always show their number, and a customer ringing it back reaches
-- them first.
--
-- tenant_users.outbound_did holds the 10-digit number (dids.number). NULL
-- means "shared" — today's behaviour. The API checks it is still one of the
-- tenant's outgoing numbers every time it is used, so a number released or
-- switched to incoming-only falls back to shared instead of breaking calls.
--
-- Used by:
--   /api/calls/click-to-call        caller ID for that seat's Desk calls
--   /webhooks/freeswitch/inbound    a call TO the number rings that seat
--                                   first (while on shift), then the team
-- ══════════════════════════════════════════════════════════════

alter table tenant_users
  add column if not exists outbound_did text;

comment on column tenant_users.outbound_did is
  'This seat''s own calling number (dids.number). NULL = the business''s shared outgoing numbers.';
