-- ══════════════════════════════════════════════════════════════
-- 013 — INSTANT LEAD CAPTURE
--
-- Answers "before they close their browser": a website form, Facebook
-- Lead Ad, or Google Form submission hits a per-tenant webhook URL and
-- (a) is captured as a lead immediately, (b) gets an instant WhatsApp
-- acknowledgment if enabled, and (c) triggers an outbound call attempt
-- within ~30 seconds if enabled.
--
-- CONSENT NOTE — read before enabling auto_call_new_leads
-- outbound-dispatcher.ts has carried this comment since it was written:
--   "Until [a real DND provider exists], only campaigns where ALL
--    recipients have consent_call_id (callback requests) should be
--    allowed in production."
-- That carve-out was documented but never implemented. This migration
-- and the code that follows finally build it — but only as an explicit,
-- OFF-BY-DEFAULT choice (skip_dnd_for_instant_leads), not a silent
-- bypass. The reasoning: someone who just submitted YOUR OWN enquiry
-- form has, in the common industry interpretation, given consent for
-- that specific follow-up — materially different from cold-dialing a
-- purchased list. That said, this is not legal advice; if TRAI DND
-- compliance is a concern for your business, verify with a professional
-- before enabling it. Campaign (bulk list) dialing is completely
-- unaffected by this toggle and keeps requiring real DND scrubbing.
-- ══════════════════════════════════════════════════════════════

-- ── leads: two more provenance values ──
alter table leads drop constraint if exists leads_source_check;
alter table leads add constraint leads_source_check
  check (source in ('inbound_call','outbound_campaign','manual','widget','web_form','ad_lead'));

-- ── voice_profiles: per-business capture settings ──
alter table voice_profiles
  add column if not exists capture_token text
    default encode(gen_random_bytes(16), 'hex'),
  add column if not exists auto_whatsapp_new_leads boolean not null default true,
  add column if not exists auto_call_new_leads boolean not null default false,
  add column if not exists skip_dnd_for_instant_leads boolean not null default false;

-- Every existing row needs its own token (the column default only fires
-- on INSERT, not on this ALTER for already-existing rows).
update voice_profiles set capture_token = encode(gen_random_bytes(16), 'hex')
  where capture_token is null;

alter table voice_profiles alter column capture_token set not null;

create unique index if not exists idx_voice_profiles_capture_token
  on voice_profiles(capture_token);

-- ── outbound_recipients: allow campaign-less "instant" rows ──
-- A captured lead needs to go through the exact same dispatch/DND/
-- correlation machinery as a campaign recipient, without belonging to
-- any campaign. campaign_id becomes nullable; is_instant marks which
-- rows these are so the dispatcher can pick them up on their own path.
alter table outbound_recipients alter column campaign_id drop not null;

alter table outbound_recipients
  add column if not exists is_instant boolean not null default false;

alter table outbound_recipients drop constraint if exists outbound_recipients_instant_or_campaign;
alter table outbound_recipients add constraint outbound_recipients_instant_or_campaign
  check ((campaign_id is not null and is_instant = false)
      or (campaign_id is null     and is_instant = true));

create index if not exists idx_outbound_recipients_instant_pending
  on outbound_recipients(tenant_id, status)
  where is_instant = true;

comment on column voice_profiles.capture_token is
  'Secret in the lead-capture webhook URL. Regenerate to invalidate old integrations.';
comment on column outbound_recipients.is_instant is
  'true = one-off instant callback (e.g. a captured web lead), not part of a bulk campaign.';
