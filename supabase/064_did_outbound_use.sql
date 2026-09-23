-- ══════════════════════════════════════════════════════════════
-- 064 — which of a business's numbers its outgoing calls show
--
-- Every outbound path (campaign dispatcher, Desk click-to-call, the owner's
-- test call, the onboarding call) took "any assigned DID" with limit(1), so
-- a business holding three numbers dialled out as the same one every time,
-- and had no way to keep its published number for incoming calls only.
--
-- use_for_outbound marks the numbers outgoing calls may show as caller ID.
-- The API spreads calls across them by the customer's number, so one
-- customer always sees the same number. A number with it off still answers
-- every incoming call exactly as before — including callbacks.
--
-- Default true: until someone changes it, every number stays eligible and
-- nothing about today's calling changes. The owner sets it from the Desk.
-- ══════════════════════════════════════════════════════════════

alter table dids
  add column if not exists use_for_outbound boolean not null default true;

comment on column dids.use_for_outbound is
  'Outgoing calls may present this number as caller ID. Off = incoming-only; it still answers calls.';
