-- Outbound campaigns: consent record and follow-up tracking.
--
-- CONSENT
-- scrubDnd() fails safe — with no DND_SCRUB_PROVIDER_URL it blocks every
-- number, which is why no campaign has ever dialled. Rather than buy a scrub
-- feed on day one, the policy is consent-only lists: the person uploading
-- declares that every number on the list gave explicit permission to be
-- called (existing customers, enquiries, opt-ins). That declaration is the
-- tenant's defence if a complaint is ever made, so it records WHO declared it
-- and WHEN, not merely that a box was ticked.
--
-- This does not make cold lists legal. It records who accepted responsibility
-- for the list, and leaves a real DND feed as the upgrade path for lists that
-- are not consent-based.
alter table outbound_campaigns
  add column if not exists consent_declared boolean not null default false,
  add column if not exists consent_by       uuid,
  add column if not exists consent_at       timestamptz;

-- FOLLOW-UP
-- The WhatsApp follow-up goes out on the FIRST no-answer, but a recipient is
-- retried twice more after that. Without a flag each retry would send the
-- same message again, so one person who is simply away from their phone
-- would receive three identical WhatsApps.
alter table outbound_recipients
  add column if not exists wa_followup_sent boolean not null default false,
  add column if not exists outcome          text;

-- The dispatcher picks up queued recipients whose backoff has expired. Both
-- columns are in that predicate on every tick, once per running campaign.
create index if not exists outbound_recipients_dispatch_idx
  on outbound_recipients (campaign_id, status, next_attempt_at);
