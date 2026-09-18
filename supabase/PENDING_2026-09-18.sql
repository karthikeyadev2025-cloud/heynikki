-- ════════════════════════════════════════════════════════════════════
-- HEY NIKKI — PENDING MIGRATIONS, IN ORDER
-- Generated 18 Sep 2026. Paste the whole file into the Supabase SQL editor
-- and run it once. Every statement is safe to run twice.
--
-- Checked against the live database before generating:
--   046  app_device_tokens        MISSING  (phone app voice is dead without it)
--   050  dnd_scrub_results        MISSING  (DND scrub cache + compliance ledger)
--   052  calls one-row-per-channel MISSING (2 channels already have duplicates)
--   053  campaign calling window   MISSING (5 old campaigns clamped below first)
--   054  billing idempotency       MISSING (0 duplicates — clean to apply)
--   055  plans read policy         MISSING (Pricing Engine + MRR are dead)
--   013  two objects only          MISSING (the rest of 013 landed via 033)
--
-- Every other file in supabase/ is already applied — verified object by
-- object (tables, columns, indexes, policies, constraints, functions,
-- triggers) against the live schema, not by filename.
--
-- Deliberately NOT included:
--   010  outbound_recipients.exotel_call_sid — Exotel is retired; the code
--        that read it is gone. Applying it would add a dead column.
--   001/032 storage + auth objects show as "missing" only because the
--        inventory function scans the public schema; signup and the KYC
--        bucket both work, so they are applied.
--   016b wa_templates policy — superseded by three live policies with
--        different names (wa_templates_read/_write, super_admin_all).
-- ════════════════════════════════════════════════════════════════════

begin;

-- ─────────── supabase/046_app_device_tokens.sql ───────────
-- ══════════════════════════════════════════════════════════════
-- 046 — device tokens for the Hey Nikki phone app
--
-- The app keeps a microphone open for hours with the screen off, waiting
-- for "Hey Nikki". A Supabase access token dies after an hour and the
-- refresh token belongs to the WebView's session (rotating it from native
-- code would sign the dashboard out). So the phone holds its own
-- credential: an opaque 32-byte token minted once after login, stored
-- hashed, revocable per device, good for 90 days of silence.
--
-- Only /api/app/* accepts it, and those routes only do what the owner's
-- voice can do: ask about the business. It never edits anything.
-- ══════════════════════════════════════════════════════════════

create table if not exists public.app_device_tokens (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  token_hash    text not null unique,            -- sha256(token), never the token
  label         text,                            -- "Samsung Galaxy A54 · Android 14"
  platform      text not null default 'android' check (platform in ('android','ios')),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

create index if not exists app_device_tokens_user_idx
  on public.app_device_tokens(user_id, created_at desc);

alter table public.app_device_tokens enable row level security;

-- A person sees and revokes their own devices from the dashboard; minting
-- goes through the API with the service key.
drop policy if exists app_device_tokens_own on public.app_device_tokens;
create policy app_device_tokens_own on public.app_device_tokens
  for select using (auth.uid() = user_id);

drop policy if exists app_device_tokens_revoke on public.app_device_tokens;
create policy app_device_tokens_revoke on public.app_device_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────── supabase/050_dnd_scrub_ledger.sql ───────────
-- ══════════════════════════════════════════════════════════════
-- 050 — DND SCRUB LEDGER
--
-- Every DND decision this system makes, kept as a record.
--
-- Two reasons, and the compliance one is the reason it is a table rather
-- than a cache:
--
-- 1. TRAI expects a telemarketer to be able to show, for any number it
--    dialled, that the number was scrubbed and what the answer was. Until
--    now the only trace was outbound_recipients.metadata.scrub_reason,
--    which is overwritten on the next attempt and deleted with the
--    campaign. A record that disappears when the evidence is wanted is
--    not a record.
--
-- 2. A scrub costs money and a round trip to a provider that may be slow.
--    The same number is scrubbed again on every retry, and appears on
--    several campaigns for the same business. A short validity window
--    turns those into one call.
--
-- The window is deliberately conservative. A preference registered with
-- the NCPR takes effect quickly, and a cached "not on DND" that outlives
-- the customer's decision to register is exactly the failure that gets a
-- telemarketer fined. Seven days is the outer limit; DND_SCRUB_TTL_HOURS
-- can shorten it, and nothing lengthens it past the CHECK below.
--
-- A blocked result is NEVER served from cache on the permissive side:
-- expiry only ever causes a re-scrub, never an assumption that a number
-- is callable.
-- ══════════════════════════════════════════════════════════════

create table if not exists public.dnd_scrub_results (
  id            uuid          primary key default uuid_generate_v4(),
  -- Scrub answers are a property of the NUMBER and the national registry,
  -- not of one business, so this is deliberately not tenant-scoped: two
  -- tenants dialling the same number ask the registry the same question.
  -- Consent is the tenant-scoped part, and it is decided before a scrub is
  -- ever requested (see scrubDnd) — so nothing tenant-specific is cached
  -- here, and one tenant can never widen what another is allowed to dial.
  phone         text          not null,
  blocked       boolean       not null,
  reason        text,
  -- 'provider' = a real answer from a scrub provider and the only kind
  -- worth reusing. 'unavailable' = no provider configured or it failed;
  -- recorded for the audit trail, never served from cache.
  source        text          not null default 'provider'
                              check (source in ('provider', 'unavailable')),
  provider      text,
  checked_at    timestamptz   not null default now(),
  expires_at    timestamptz   not null,
  created_at    timestamptz   not null default now(),
  -- Seven days, hard. A cached "callable" that outlives the customer's
  -- registration is the expensive mistake here.
  constraint dnd_scrub_window check (expires_at <= checked_at + interval '7 days')
);

-- The lookup the dispatcher makes on every pending recipient: newest
-- usable answer for this number.
create index if not exists idx_dnd_scrub_phone_fresh
  on public.dnd_scrub_results (phone, expires_at desc);

-- The compliance query: everything we decided about one number, in order.
create index if not exists idx_dnd_scrub_phone_time
  on public.dnd_scrub_results (phone, checked_at desc);

alter table public.dnd_scrub_results enable row level security;

-- Service-role only. This is a regulatory record written by the dispatcher
-- and read by the dispatcher; no browser session has any business reading
-- the national DND status of numbers belonging to other businesses, and
-- the table is not tenant-scoped so a tenant policy could not be written
-- correctly anyway. With RLS on and no policy, PostgREST returns nothing
-- to an anon or authenticated caller, which is the intent.
--
-- (Migration 032 is the precedent: a bucket with RLS and no policy was a
-- BUG there because the dashboard needed to read it. Here it is the
-- design, so it is stated rather than left to be rediscovered.)

-- ── Why a number was opted out, not just that it was ──────────────
-- outbound_opt_outs.reason already exists but is free text set by the
-- panel. A caller who tells Nikki on the phone to stop calling is the
-- most common real opt-out and had nowhere to be written from; these
-- columns let that path record itself distinctly from an operator's
-- manual entry, which matters when someone asks who removed a number.
alter table public.outbound_opt_outs
  add column if not exists source text not null default 'panel';

alter table public.outbound_opt_outs
  add column if not exists call_id uuid;

comment on column public.outbound_opt_outs.source is
  'panel | call | api | import — where the opt-out came from';
comment on column public.outbound_opt_outs.call_id is
  'the call on which the customer asked not to be called again, when source = call';

-- ─────────── supabase/052_call_row_per_channel.sql ───────────
-- One calls row per FreeSWITCH channel.
--
-- The pipeline retries /webhooks/freeswitch/inbound when it times out, and
-- each attempt inserted a row: on 13 Sep one outbound call to 8885490495
-- produced two rows at the same instant (one 'missed' 0s, one 'completed' 8s).
-- The hangup hook's .single() then matched neither, so the call was never
-- completed or billed. The API now reuses an existing row; this index makes
-- that a guarantee under a concurrent retry.
--
-- Existing duplicates (2 channels as of 16 Sep) are detached, not deleted:
-- the oldest row keeps the channel id, later ones keep their data with a
-- NULL livekit_room_id so the index can be built.
with ranked as (
  select id,
         row_number() over (partition by livekit_room_id order by created_at, id) as rn
  from calls
  where livekit_room_id is not null
)
update calls c
   set livekit_room_id = null,
       status = case when c.status = 'active' then 'failed' else c.status end
  from ranked r
 where c.id = r.id and r.rn > 1;

create unique index if not exists calls_livekit_room_id_uniq
  on calls (livekit_room_id) where livekit_room_id is not null;

-- ─────────── supabase/013_lead_capture.sql — the two objects it never got ───────────
-- The rest of 013 was re-applied by 033. These two were not. The CHECK is the
-- rule the dispatcher already relies on: a row is either a campaign recipient
-- or an instant callback, never both and never neither. Verified against live
-- data before generating this file — 0 rows violate it, so it applies clean.
alter table outbound_recipients drop constraint if exists outbound_recipients_instant_or_campaign;
alter table outbound_recipients add constraint outbound_recipients_instant_or_campaign
  check ((campaign_id is not null and is_instant = false)
      or (campaign_id is null     and is_instant = true));

create index if not exists idx_outbound_recipients_instant_pending
  on outbound_recipients(tenant_id, status)
  where is_instant = true;

-- ─────────── PRE-FIX for 053 (generated from live data) ───────────
-- All five existing campaigns were created with midnight test windows
-- (00:15–00:20, 02:10–02:15, 01:00–01:05, 02:50–19:00, 20:35–19:00 — the
-- last one ends before it starts). None is running; all are draft, paused or
-- completed. Left as they are, the NOT VALID constraint below would reject
-- the dispatcher's own later status updates to those rows. Clamp them into
-- TRAI hours first; a campaign nobody restarts is unaffected either way.
update outbound_campaigns
   set window_start = greatest(coalesce(window_start, '09:00'::time), '09:00'::time),
       window_end   = least(coalesce(window_end,   '21:00'::time), '21:00'::time)
 where window_start < '09:00' or window_end > '21:00' or window_end <= window_start;

-- Anything still inverted (end <= start) gets the full permitted day.
update outbound_campaigns
   set window_start = '09:00'::time, window_end = '21:00'::time
 where window_end <= window_start;

-- ─────────── supabase/053_campaign_calling_window.sql ───────────
-- ══════════════════════════════════════════════════════════════
-- 051 — a campaign cannot be told to ring people at night
--
-- window_start / window_end were free `time` columns. The dashboard inserts
-- campaigns straight into the table (RLS, no API in between) and the
-- schedule route accepted any HH:MM, so a campaign could be saved to dial
-- from 06:00 or until 23:30 and the dispatcher would do exactly that. TRAI
-- permits these calls between 09:00 and 21:00.
--
-- The API now validates (campaign-import.ts, outbound.ts) and refuses to
-- start a campaign whose stored window is outside those hours. This is the
-- guarantee for every other writer.
--
-- NOT VALID: existing rows are not checked, so applying this cannot fail on
-- an old campaign. But Postgres checks the constraint on EVERY update of a
-- row, including ones that never touch the window — so an old out-of-hours
-- campaign would then refuse the dispatcher's own status updates (pause,
-- completed). Run the select below FIRST and fix what it returns (clamp to
-- 09:00–21:00, or cancel the campaign), then apply, then VALIDATE.
--
--   select id, tenant_id, name, status, window_start, window_end
--     from outbound_campaigns
--    where window_start < '09:00' or window_end > '21:00' or window_end <= window_start;
-- ══════════════════════════════════════════════════════════════

alter table outbound_campaigns
  drop constraint if exists outbound_campaigns_trai_window;

alter table outbound_campaigns
  add constraint outbound_campaigns_trai_window
  check (window_start >= time '09:00' and window_end <= time '21:00' and window_end > window_start)
  not valid;

-- After fixing any rows the select above returns:
-- alter table outbound_campaigns validate constraint outbound_campaigns_trai_window;

-- ─────────── supabase/054_billing_idempotency.sql ───────────
-- ══════════════════════════════════════════════════════════════
-- 052 — a payment is applied once, even when Razorpay delivers it twice
--
-- Two writes in api-server/src/index.ts are keyed on a Razorpay id and
-- guarded in code by "look, then insert". That is enough for a retry that
-- arrives later; it is not enough for two deliveries of the same event
-- arriving together, which Razorpay does.
--
--   credit_ledger  payment.captured for an add-on grants minutes with
--                  reason 'addon_minutes:<payment id>'. Two concurrent
--                  deliveries could both see no row and both grant.
--   subscriptions  /api/billing/verify records one row per order with its
--                  current_period_end. A double-submitted verify could
--                  record the same order twice and extend the period twice.
--
-- The code already treats a duplicate-key error on either insert as
-- "somebody else applied it" and works without these indexes.
-- ══════════════════════════════════════════════════════════════

create unique index if not exists credit_ledger_addon_payment_key
  on credit_ledger (reason)
  where reason like 'addon_minutes:%';

-- Check first — an existing duplicate makes this fail:
--   select tenant_id, razorpay_order_id, count(*) from subscriptions
--    where razorpay_order_id is not null group by 1, 2 having count(*) > 1;
create unique index if not exists subscriptions_tenant_order_key
  on subscriptions (tenant_id, razorpay_order_id)
  where razorpay_order_id is not null;

-- The plan-expiry job reads a tenant's latest period end on every run.
create index if not exists subscriptions_tenant_period_end_idx
  on subscriptions (tenant_id, current_period_end desc);

-- ─────────── supabase/055_plans_readable.sql ───────────
-- The price catalogue nobody can read.
--
-- `plans` has row level security ENABLED with NO policy, which denies every
-- role except service_role. It is not in the enable-RLS block of 001, so it
-- was switched on out of band and the migrations never described the live
-- state. Proven: the same select returns [] with a user JWT and 4 rows with
-- the service key.
--
-- What that breaks, silently, for everyone:
--   - super-admin Pricing Engine: the plan grid is always empty, so no plan
--     can ever be edited.
--   - super-admin Revenue: planPrice() finds nothing, so Est. MRR and ARR
--     read ₹0 however many customers are paying.
--   - any dashboard page that wants to show what a plan includes.
--
-- These are public prices — the same figures the marketing pricing page
-- prints — so SELECT is open to everyone. Writes stay restricted to
-- super_admin (the panel edits plans through the API's service key anyway).
alter table public.plans enable row level security;

drop policy if exists "plans: anyone may read" on public.plans;
create policy "plans: anyone may read"
  on public.plans for select
  using (true);

drop policy if exists "plans: super admin writes" on public.plans;
create policy "plans: super admin writes"
  on public.plans for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

commit;

-- ─────────── after the commit, validate the campaign window ───────────
-- Separate statement on purpose: VALIDATE takes a lock and cannot run in the
-- same transaction as the ALTER that added the constraint.
alter table outbound_campaigns validate constraint outbound_campaigns_trai_window;

-- ─────────── verify (all four should return rows / true) ───────────
select 'app_device_tokens'  as object, to_regclass('public.app_device_tokens')  is not null as ok
union all select 'dnd_scrub_results', to_regclass('public.dnd_scrub_results') is not null
union all select 'calls_livekit_uniq', exists(select 1 from pg_indexes where indexname = 'calls_livekit_room_id_uniq')
union all select 'plans_read_policy',  exists(select 1 from pg_policies where tablename = 'plans' and cmd = 'SELECT')
union all select 'recipient_xor_check', exists(select 1 from pg_constraint where conname = 'outbound_recipients_instant_or_campaign');
