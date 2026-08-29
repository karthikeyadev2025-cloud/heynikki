-- ══════════════════════════════════════════════════════════════
-- 023 — INSTANT LEAD CALLBACKS
--
-- When a tenant has auto_call_new_leads on, a lead who fills in the
-- website form should be rung back immediately. There is no campaign for
-- that — there is one lead. Two parts of the system are written for it:
--
--   * api-server/src/index.ts lead-capture inserts a recipient with
--     is_instant: true and campaign_id: null
--   * jobs/outbound-dispatcher.ts dispatchInstant() selects
--     is_instant = true and handles a null campaign
--
-- Neither could ever have worked, because the table has no is_instant
-- column at all and campaign_id is NOT NULL. The insert fails on the
-- unknown column, inside a .then() that only logs; the dispatcher's
-- select fails 42703 and quietly finds nothing. The website form still
-- returns 200, the lead is still captured, and the callback the tenant
-- switched on has never once happened.
--
-- An earlier version of this migration added the constraint below
-- without adding the column, which is why it failed with 42703 on the
-- CHECK. The column comes first now.
-- ══════════════════════════════════════════════════════════════

alter table outbound_recipients
  add column if not exists is_instant boolean not null default false;

alter table outbound_recipients
  alter column campaign_id drop not null;

-- A recipient must belong to SOMETHING: a campaign, or explicitly an
-- instant callback. Without this, dropping NOT NULL would also permit an
-- orphan row that no dispatcher path would ever pick up.
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

-- dispatchInstant() polls this every 30 seconds.
create index if not exists outbound_recipients_instant_idx
  on outbound_recipients(status) where is_instant = true;

comment on column outbound_recipients.campaign_id is
  'Null only for is_instant=true rows — a one-off callback to a lead who just enquired.';
comment on column outbound_recipients.is_instant is
  'True for a one-off callback created by lead capture, not part of any campaign.';
