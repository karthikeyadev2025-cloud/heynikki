-- ══════════════════════════════════════════════════════════════
-- 048 — per-RECIPIENT consent
--
-- 019 recorded consent on outbound_campaigns: who uploaded a list and
-- declared that everyone on it had agreed to be called. That is the right
-- record for a bulk campaign, where consent is a property of the list.
--
-- A call placed over the public API has no list. The business's own
-- software attests, per request, that THIS customer asked to be
-- contacted — and POST /api/v1/calls/outbound refuses the request
-- without it. So the attestation belongs on the row that becomes the
-- call, not on a campaign that does not exist. tickInstant reads it as
-- consent alongside consent_call_id.
--
-- Kept as real columns rather than a metadata key: this is the record a
-- business would produce if a TRAI complaint were ever made about a
-- number, and that has to be queryable and visible in the table, not
-- buried in a jsonb blob.
-- ══════════════════════════════════════════════════════════════

alter table public.outbound_recipients
  add column if not exists consent_declared boolean not null default false,
  -- Who claimed it. Null for an API-placed call: the claim was made by a
  -- key, and api_key_id (047) already says which one.
  add column if not exists consent_by       uuid,
  add column if not exists consent_at       timestamptz;

-- Every consent-bearing row we can find, for the complaint that names a
-- number and a date. Partial: the vast majority of rows carry no claim.
create index if not exists outbound_recipients_consent_idx
  on public.outbound_recipients(tenant_id, phone, consent_at desc)
  where consent_declared;
