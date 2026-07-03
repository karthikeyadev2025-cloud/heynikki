-- ============================================================
-- NIKKI — Outbound calling campaigns (Growth + Scale plans)
-- ============================================================
-- TRAI COMPLIANCE NOTES — READ BEFORE BUILDING ON THIS:
--
-- 1. Outbound calls to numbers NOT on your DND (Do Not Disturb) list
--    are regulated under TRAI's TCCCPR-2018. The penalty for a single
--    violation can be ₹25,000-₹50,000.
-- 2. You MUST scrub recipient numbers against TRAI's NCPR (National
--    Customer Preference Register). Implementation note for backend:
--    use a commercial DND-scrub API (Exotel, Knowlarity, or TRAI's
--    direct feed) BEFORE dialing. We store the scrub result per
--    recipient.
-- 3. Numbers given by callers AS A CONSENT-BASED CALLBACK REQUEST
--    are exempt from DND scrubbing — but you must keep proof of the
--    consent (the original inbound call that requested the callback).
-- 4. All outbound calls must play TRAI AI-disclosure within the
--    first 5 seconds (already handled by main.py on_call_start).
-- 5. Outbound calling hours: only 09:00-21:00 in the recipient's
--    timezone. We enforce this in the scheduler.
-- ============================================================

create table if not exists public.outbound_campaigns (
  id            uuid          primary key default uuid_generate_v4(),
  tenant_id     uuid          not null references public.tenants(id) on delete cascade,
  created_by    uuid          references auth.users(id) on delete set null,

  name          text          not null,
  -- The script the AI follows. {{first_name}} and {{business_name}} are
  -- the only supported template vars to keep it simple.
  script        text          not null,

  -- Voice profile to use (FK to voice_profiles)
  voice_profile_id uuid       references public.voice_profiles(id) on delete set null,

  -- Calling window (recipient-local). HH:MM 24h.
  window_start  time          not null default '10:00',
  window_end    time          not null default '19:00',

  -- Concurrency cap so we don't burn our LiveKit budget if a 10k-row
  -- list goes wild. Hard ceiling enforced in the dispatcher.
  max_concurrent int          not null default 3 check (max_concurrent between 1 and 25),

  status        text          not null default 'draft'
                  check (status in ('draft', 'running', 'paused', 'completed', 'cancelled')),

  created_at    timestamptz   not null default now(),
  started_at    timestamptz,
  completed_at  timestamptz
);

create table if not exists public.outbound_recipients (
  id            uuid          primary key default uuid_generate_v4(),
  campaign_id   uuid          not null references public.outbound_campaigns(id) on delete cascade,
  tenant_id     uuid          not null references public.tenants(id) on delete cascade,

  phone         text          not null,
  first_name    text,                                  -- for {{first_name}} in script
  metadata      jsonb         not null default '{}'::jsonb,

  -- DND scrubbing result. NULL = not yet scrubbed. true = on DND, do NOT call.
  dnd_blocked   boolean,
  scrubbed_at   timestamptz,

  -- Consent proof — populated when this number came from an inbound callback request
  consent_call_id uuid        references public.calls(id) on delete set null,

  -- Dispatch state
  status        text          not null default 'pending'
                  check (status in ('pending', 'scrubbing', 'queued', 'in_progress',
                                    'completed', 'failed', 'blocked_dnd', 'opted_out')),

  -- Call record (after dispatch)
  call_id       uuid          references public.calls(id) on delete set null,

  attempts      int           not null default 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,                         -- for retry scheduling

  created_at    timestamptz   not null default now()
);

create index if not exists idx_outbound_campaigns_tenant     on public.outbound_campaigns(tenant_id, created_at desc);
create index if not exists idx_outbound_recipients_campaign  on public.outbound_recipients(campaign_id, status);
create index if not exists idx_outbound_recipients_next      on public.outbound_recipients(next_attempt_at) where status in ('queued', 'pending');

-- ─── RLS ──────────────────────────────────────────────
alter table public.outbound_campaigns enable row level security;
alter table public.outbound_recipients enable row level security;

drop policy if exists "outbound_campaigns: tenant members" on public.outbound_campaigns;
create policy "outbound_campaigns: tenant members"
  on public.outbound_campaigns for all
  using (tenant_id in (select tenant_id from public.tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from public.tenant_users where user_id = auth.uid()));

drop policy if exists "outbound_recipients: tenant members" on public.outbound_recipients;
create policy "outbound_recipients: tenant members"
  on public.outbound_recipients for all
  using (tenant_id in (select tenant_id from public.tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from public.tenant_users where user_id = auth.uid()));

-- Tenant-level opt-outs — recipients can text "STOP" or call a DNC line.
-- Once added here, they're blocked across ALL future campaigns for this tenant.
create table if not exists public.outbound_opt_outs (
  id           uuid          primary key default uuid_generate_v4(),
  tenant_id    uuid          not null references public.tenants(id) on delete cascade,
  phone        text          not null,
  reason       text,
  created_at   timestamptz   not null default now(),
  unique (tenant_id, phone)
);

create index if not exists idx_opt_outs_tenant_phone on public.outbound_opt_outs(tenant_id, phone);

alter table public.outbound_opt_outs enable row level security;

drop policy if exists "opt_outs: tenant members" on public.outbound_opt_outs;
create policy "opt_outs: tenant members"
  on public.outbound_opt_outs for all
  using (tenant_id in (select tenant_id from public.tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from public.tenant_users where user_id = auth.uid()));

comment on table public.outbound_opt_outs is
  'Tenant-level Do-Not-Call list. Populated when a recipient texts STOP
   or calls a DNC line. Checked on every dispatch — blocked numbers
   are filtered out before the campaign even queues.';
