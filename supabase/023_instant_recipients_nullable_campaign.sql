-- ══════════════════════════════════════════════════════════════
-- 023 — INSTANT RECIPIENTS NEED A NULLABLE CAMPAIGN
--
-- outbound_recipients.campaign_id is NOT NULL, but two parts of the
-- system deliberately create recipients with no campaign:
--
--   * api-server/src/index.ts lead-capture, when a tenant has
--     auto_call_new_leads on — a lead fills the website form and should
--     be rung back immediately. There is no campaign; there is one lead.
--   * jobs/outbound-dispatcher.ts dispatchInstant(), which selects
--     is_instant=true recipients and already handles a null campaign
--     ("campaign is null for instant recipients" — its own comment).
--
-- So the writer inserts null, the column forbids null, and the insert
-- fails with 23502 every single time. The failure is logged inside a
-- .then() and never surfaces: the API still returns 200 to the website
-- form, the lead is still captured, and the automatic call back simply
-- never happens. Nobody gets an error; the feature just does not exist.
--
-- The dispatcher's own is_instant query is the proof the null case was
-- intended. This makes the column agree with it.
-- ══════════════════════════════════════════════════════════════

alter table outbound_recipients
  alter column campaign_id drop not null;

-- A recipient must still belong to SOMETHING: either a campaign, or be
-- explicitly flagged instant. Without this, dropping NOT NULL would also
-- permit an orphan row that no dispatcher path would ever pick up.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'outbound_recipients_campaign_or_instant'
  ) then
    alter table outbound_recipients
      add constraint outbound_recipients_campaign_or_instant
      check (campaign_id is not null or is_instant = true);
  end if;
end $$;

comment on column outbound_recipients.campaign_id is
  'Null only for is_instant=true rows — a one-off callback to a lead who just enquired.';
