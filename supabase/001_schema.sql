-- ============================================================
-- NIKKI — Complete Database Schema
-- Powered by Nikki Tech Labs
--
-- Run in: Supabase SQL Editor → New Query → Run All
-- Project: wnawozdmmxuziucavngw
-- ============================================================

-- ── EXTENSIONS ───────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ── TENANTS ──────────────────────────────────────────────────
create table if not exists tenants (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  plan             text not null default 'trial'
                   check (plan in ('trial','starter','growth','scale')),
  status           text not null default 'trial'
                   check (status in ('trial','active','suspended','cancelled')),
  trial_ends_at    timestamptz default (now() + interval '14 days'),
  wallet_balance   integer not null default 0,        -- paise
  owner_id         uuid references auth.users(id) on delete cascade,
  razorpay_sub_id  text,
  razorpay_cust_id text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- ── TENANT USERS ─────────────────────────────────────────────
create table if not exists tenant_users (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid references tenants(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete cascade,
  role       text not null default 'owner'
             check (role in ('owner','member','support','super_admin')),
  created_at timestamptz default now(),
  unique(user_id)
);

-- ── VOICE PROFILES ───────────────────────────────────────────
-- NOTE: Never called "agents" anywhere — voice_profile_id throughout
create table if not exists voice_profiles (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid references tenants(id) on delete cascade,
  profile_sku       text not null default 'standard'
                    check (profile_sku in ('standard','clinic','real_estate','premium')),
  display_name      text,
  business_name     text not null default '',
  open_time         text default '09:00',
  close_time        text default '21:00',
  open_days         text[] default array['Mon','Tue','Wed','Thu','Fri','Sat'],
  services          text[] default array[]::text[],
  appointment_types text[] default array[]::text[],
  whatsapp_number   text,
  did_number        text,
  exotel_did        text,
  provider          text default 'exotel',
  status            text default 'active'
                    check (status in ('active','paused','setup')),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- ── PHONE NUMBERS ────────────────────────────────────────────
create table if not exists phone_numbers (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references tenants(id) on delete cascade,
  voice_profile_id uuid references voice_profiles(id) on delete set null,
  number           text not null,
  exotel_did       text,
  provider         text default 'exotel'
                   check (provider in ('exotel','plivo','twilio')),
  monthly_cost     integer default 250,   -- paise
  status           text default 'active'
                   check (status in ('active','inactive','released')),
  created_at       timestamptz default now()
);

-- ── CALLS ────────────────────────────────────────────────────
create table if not exists calls (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid references tenants(id) on delete cascade,
  voice_profile_id     uuid references voice_profiles(id) on delete set null,
  caller_number        text,
  direction            text not null default 'inbound'
                       check (direction in ('inbound','outbound')),
  status               text default 'active'
                       check (status in ('active','completed','missed','transferred','failed')),
  duration_seconds     integer default 0,
  transcript           jsonb default '[]'::jsonb,
  intent               text,
  recording_url        text,
  recording_path       text,
  wa_sent              boolean default false,
  appointment_created  boolean default false,
  cost_paise           integer default 0,
  exotel_call_sid      text,
  livekit_room_id      text,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

-- ── APPOINTMENTS ─────────────────────────────────────────────
create table if not exists appointments (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references tenants(id) on delete cascade,
  voice_profile_id uuid references voice_profiles(id) on delete set null,
  call_id          uuid references calls(id) on delete set null,
  caller_name      text,
  caller_number    text not null,
  service          text,
  slot_date        date,
  slot_time        text,
  status           text default 'confirmed'
                   check (status in ('confirmed','cancelled','completed','no_show','rescheduled')),
  wa_confirmed     boolean default false,
  wa_reminder_sent boolean default false,
  notes            text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- ── WHATSAPP DISPATCH LOG ────────────────────────────────────
create table if not exists wa_dispatch_log (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references tenants(id) on delete cascade,
  voice_profile_id uuid references voice_profiles(id) on delete set null,
  call_id          uuid references calls(id) on delete set null,
  appointment_id   uuid references appointments(id) on delete set null,
  message_type     text check (message_type in
                   ('confirmation','missed_call','reminder','callback','survey','custom')),
  to_number        text not null,
  message_body     text,
  status           text default 'sent'
                   check (status in ('sent','delivered','read','failed')),
  provider_msg_id  text,
  sent_at          timestamptz default now()
);

-- ── SUBSCRIPTIONS ────────────────────────────────────────────
create table if not exists subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid references tenants(id) on delete cascade,
  plan_id              text not null,
  razorpay_sub_id      text unique,
  razorpay_order_id    text,
  status               text default 'active',
  current_period_start timestamptz,
  current_period_end   timestamptz,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

-- ── CALL MINUTES USAGE ───────────────────────────────────────
create table if not exists call_minutes (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid references tenants(id) on delete cascade,
  month               text not null,                  -- 'YYYY-MM'
  used_seconds        integer default 0,
  plan_limit_seconds  integer default 12000,          -- 200 min default (trial/starter)
  unique(tenant_id, month)
);

-- ── KNOWLEDGE BASE (RAG per voice profile) ───────────────────
create table if not exists knowledge_base (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references tenants(id) on delete cascade,
  voice_profile_id uuid references voice_profiles(id) on delete cascade,
  content          text not null,
  embedding        vector(1536),
  source_type      text default 'faq'
                   check (source_type in ('faq','document','manual','url')),
  source_name      text,
  created_at       timestamptz default now()
);

-- ── CAMPAIGNS (outbound) ─────────────────────────────────────
create table if not exists campaigns (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references tenants(id) on delete cascade,
  voice_profile_id uuid references voice_profiles(id) on delete set null,
  name             text not null,
  status           text default 'draft'
                   check (status in ('draft','scheduled','running','paused','completed','failed')),
  total_contacts   integer default 0,
  called_count     integer default 0,
  answered_count   integer default 0,
  booked_count     integer default 0,
  scheduled_at     timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz default now()
);

create table if not exists campaign_contacts (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid references campaigns(id) on delete cascade,
  tenant_id    uuid references tenants(id) on delete cascade,
  phone_number text not null,
  name         text,
  status       text default 'pending'
               check (status in ('pending','calling','answered','no_answer','booked','failed','dnd')),
  call_id      uuid references calls(id) on delete set null,
  called_at    timestamptz,
  created_at   timestamptz default now()
);

-- ── INVOICES ─────────────────────────────────────────────────
create table if not exists invoices (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid references tenants(id) on delete cascade,
  razorpay_payment_id text,
  razorpay_order_id  text,
  amount_paise       integer not null,
  plan_id            text,
  description        text,
  status             text default 'paid'
                     check (status in ('paid','failed','refunded')),
  pdf_url            text,
  created_at         timestamptz default now()
);

-- ── ADMIN AUDIT LOG ──────────────────────────────────────────
create table if not exists admin_audit_log (
  id               uuid primary key default gen_random_uuid(),
  admin_user_id    uuid references auth.users(id),
  action           text not null,
  target_tenant_id uuid references tenants(id),
  metadata         jsonb default '{}'::jsonb,
  ip_address       text,
  created_at       timestamptz default now()
);

-- ── PLANS (reference) ────────────────────────────────────────
create table if not exists plans (
  id                   text primary key,
  display_name         text not null,
  price_monthly_paise  integer not null,
  price_annual_paise   integer not null,
  minutes_per_month    integer not null,
  max_voice_profiles   integer not null,
  max_phone_numbers    integer not null,
  max_concurrent_calls integer not null,
  outbound_campaigns   boolean default false,
  api_access           boolean default false,
  recording_days       integer default 90
);

insert into plans values
  ('trial',   'Free Trial',  0,       0,       200,  1,  1,  2,  false, false, 7),
  ('starter', 'Starter',     199900,  1599900, 200,  1,  1,  2,  false, false, 90),
  ('growth',  'Growth',      499900,  3999900, 600,  3,  3,  5,  true,  false, 365),
  ('scale',   'Scale',       999900,  7999900, 1500, 10, 10, 15, true,  true,  730)
on conflict (id) do update set
  price_monthly_paise = excluded.price_monthly_paise,
  minutes_per_month   = excluded.minutes_per_month,
  max_voice_profiles  = excluded.max_voice_profiles;

-- ══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════
alter table tenants           enable row level security;
alter table tenant_users      enable row level security;
alter table voice_profiles    enable row level security;
alter table phone_numbers     enable row level security;
alter table calls             enable row level security;
alter table appointments      enable row level security;
alter table wa_dispatch_log   enable row level security;
alter table subscriptions     enable row level security;
alter table call_minutes      enable row level security;
alter table knowledge_base    enable row level security;
alter table campaigns         enable row level security;
alter table campaign_contacts enable row level security;
alter table invoices          enable row level security;
alter table admin_audit_log   enable row level security;

-- ── HELPER FUNCTIONS ─────────────────────────────────────────
-- Both fixed for the same search_path bug found in handle_new_user() —
-- these two back nearly every RLS policy below, so an unqualified
-- `tenant_users` reference here is a much bigger blast radius than the
-- signup trigger alone.
create or replace function get_my_tenant_id()
returns uuid language sql stable security definer
set search_path = public, pg_temp
as $$
  select tenant_id from public.tenant_users where user_id = auth.uid() limit 1;
$$;

create or replace function is_super_admin()
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists(
    select 1 from public.tenant_users
    where user_id = auth.uid() and role = 'super_admin'
  );
$$;

-- ── TENANTS POLICIES ─────────────────────────────────────────
drop policy if exists "tenant_select" on tenants;
drop policy if exists "tenant_insert" on tenants;
drop policy if exists "tenant_update" on tenants;

create policy "tenant_select" on tenants for select
  using (id = get_my_tenant_id() or is_super_admin());
create policy "tenant_insert" on tenants for insert
  with check (owner_id = auth.uid());
create policy "tenant_update" on tenants for update
  using (id = get_my_tenant_id() or is_super_admin());

-- ── TENANT_USERS POLICIES ────────────────────────────────────
drop policy if exists "tu_select" on tenant_users;
drop policy if exists "tu_insert" on tenant_users;

create policy "tu_select" on tenant_users for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "tu_insert" on tenant_users for insert
  with check (tenant_id = get_my_tenant_id() or is_super_admin());

-- ── VOICE_PROFILES POLICIES ──────────────────────────────────
drop policy if exists "vp_select" on voice_profiles;
drop policy if exists "vp_insert" on voice_profiles;
drop policy if exists "vp_update" on voice_profiles;
drop policy if exists "vp_delete" on voice_profiles;

create policy "vp_select" on voice_profiles for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "vp_insert" on voice_profiles for insert
  with check (tenant_id = get_my_tenant_id());
create policy "vp_update" on voice_profiles for update
  using (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "vp_delete" on voice_profiles for delete
  using (tenant_id = get_my_tenant_id() or is_super_admin());

-- ── PHONE_NUMBERS POLICIES ───────────────────────────────────
drop policy if exists "pn_select" on phone_numbers;
drop policy if exists "pn_insert" on phone_numbers;
drop policy if exists "pn_update" on phone_numbers;

create policy "pn_select" on phone_numbers for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "pn_insert" on phone_numbers for insert
  with check (tenant_id = get_my_tenant_id());
create policy "pn_update" on phone_numbers for update
  using (tenant_id = get_my_tenant_id() or is_super_admin());

-- ── CALLS POLICIES ───────────────────────────────────────────
drop policy if exists "calls_select" on calls;
drop policy if exists "calls_insert" on calls;
drop policy if exists "calls_update" on calls;

create policy "calls_select" on calls for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "calls_insert" on calls for insert
  with check (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "calls_update" on calls for update
  using (tenant_id = get_my_tenant_id() or is_super_admin());

-- ── APPOINTMENTS POLICIES ────────────────────────────────────
drop policy if exists "appt_select" on appointments;
drop policy if exists "appt_insert" on appointments;
drop policy if exists "appt_update" on appointments;

create policy "appt_select" on appointments for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "appt_insert" on appointments for insert
  with check (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "appt_update" on appointments for update
  using (tenant_id = get_my_tenant_id() or is_super_admin());

-- ── WA_DISPATCH_LOG POLICIES ─────────────────────────────────
drop policy if exists "wa_select" on wa_dispatch_log;
drop policy if exists "wa_insert" on wa_dispatch_log;

create policy "wa_select" on wa_dispatch_log for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "wa_insert" on wa_dispatch_log for insert
  with check (tenant_id = get_my_tenant_id() or is_super_admin());

-- ── SUBSCRIPTIONS POLICIES ───────────────────────────────────
drop policy if exists "sub_select" on subscriptions;
drop policy if exists "sub_insert" on subscriptions;

create policy "sub_select" on subscriptions for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "sub_insert" on subscriptions for insert
  with check (tenant_id = get_my_tenant_id() or is_super_admin());

-- ── CALL_MINUTES POLICIES ────────────────────────────────────
drop policy if exists "cm_select" on call_minutes;
drop policy if exists "cm_insert" on call_minutes;
drop policy if exists "cm_update" on call_minutes;

create policy "cm_select" on call_minutes for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "cm_insert" on call_minutes for insert
  with check (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "cm_update" on call_minutes for update
  using (tenant_id = get_my_tenant_id() or is_super_admin());

-- ── KNOWLEDGE_BASE POLICIES ──────────────────────────────────
drop policy if exists "kb_select" on knowledge_base;
drop policy if exists "kb_insert" on knowledge_base;
drop policy if exists "kb_delete" on knowledge_base;

create policy "kb_select" on knowledge_base for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "kb_insert" on knowledge_base for insert
  with check (tenant_id = get_my_tenant_id());
create policy "kb_delete" on knowledge_base for delete
  using (tenant_id = get_my_tenant_id() or is_super_admin());

-- ── CAMPAIGNS POLICIES ───────────────────────────────────────
drop policy if exists "camp_select" on campaigns;
drop policy if exists "camp_insert" on campaigns;
drop policy if exists "camp_update" on campaigns;

create policy "camp_select" on campaigns for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "camp_insert" on campaigns for insert
  with check (tenant_id = get_my_tenant_id());
create policy "camp_update" on campaigns for update
  using (tenant_id = get_my_tenant_id() or is_super_admin());

-- ── CAMPAIGN_CONTACTS POLICIES ───────────────────────────────
drop policy if exists "cc_select" on campaign_contacts;
drop policy if exists "cc_insert" on campaign_contacts;
drop policy if exists "cc_update" on campaign_contacts;

create policy "cc_select" on campaign_contacts for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "cc_insert" on campaign_contacts for insert
  with check (tenant_id = get_my_tenant_id());
create policy "cc_update" on campaign_contacts for update
  using (tenant_id = get_my_tenant_id() or is_super_admin());

-- ── INVOICES POLICIES ────────────────────────────────────────
drop policy if exists "inv_select" on invoices;
drop policy if exists "inv_insert" on invoices;

create policy "inv_select" on invoices for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "inv_insert" on invoices for insert
  with check (tenant_id = get_my_tenant_id() or is_super_admin());

-- ── ADMIN_AUDIT_LOG POLICIES ─────────────────────────────────
drop policy if exists "audit_select" on admin_audit_log;
drop policy if exists "audit_insert" on admin_audit_log;

create policy "audit_select" on admin_audit_log for select
  using (is_super_admin());
create policy "audit_insert" on admin_audit_log for insert
  with check (is_super_admin());

-- ══════════════════════════════════════════════════════════════
-- FUNCTIONS
-- ══════════════════════════════════════════════════════════════

-- Increment call minutes used (called by voice pipeline after each call)
create or replace function increment_call_minutes(p_tenant_id uuid, p_seconds integer)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_month text := to_char(now(), 'YYYY-MM');
begin
  insert into public.call_minutes (tenant_id, month, used_seconds, plan_limit_seconds)
  values (p_tenant_id, v_month, p_seconds, 12000)
  on conflict (tenant_id, month)
  do update set used_seconds = call_minutes.used_seconds + excluded.used_seconds;
end;
$$;

-- Check if tenant has minutes remaining
create or replace function tenant_has_minutes(p_tenant_id uuid)
returns boolean language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_month  text := to_char(now(), 'YYYY-MM');
  v_used   integer;
  v_limit  integer;
  v_plan   text;
begin
  select plan into v_plan from public.tenants where id = p_tenant_id;
  if v_plan = 'suspended' then return false; end if;

  select used_seconds, plan_limit_seconds
  into v_used, v_limit
  from public.call_minutes
  where tenant_id = p_tenant_id and month = v_month;

  if v_used is null then return true; end if;
  return v_used < v_limit;
end;
$$;

-- Get tenant stats for dashboard
create or replace function get_tenant_stats(p_tenant_id uuid)
returns json language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_today       text := to_char(now(), 'YYYY-MM-DD');
  v_month       text := to_char(now(), 'YYYY-MM');
  v_total       integer;
  v_appts       integer;
  v_missed      integer;
  v_wa          integer;
  v_used_sec    integer;
  v_limit_sec   integer;
begin
  select count(*), count(*) filter (where appointment_created), count(*) filter (where status='missed'), count(*) filter (where wa_sent)
  into v_total, v_appts, v_missed, v_wa
  from public.calls
  where tenant_id = p_tenant_id and created_at >= (v_today || 'T00:00:00')::timestamptz;

  select used_seconds, plan_limit_seconds into v_used_sec, v_limit_sec
  from public.call_minutes where tenant_id = p_tenant_id and month = v_month;

  return json_build_object(
    'today', json_build_object(
      'total', coalesce(v_total,0), 'appointments', coalesce(v_appts,0),
      'missed', coalesce(v_missed,0), 'wa_sent', coalesce(v_wa,0)
    ),
    'minutes', json_build_object(
      'used', coalesce(v_used_sec,0) / 60,
      'limit', coalesce(v_limit_sec,12000) / 60
    )
  );
end;
$$;

-- Vector similarity search for RAG knowledge base
create or replace function match_knowledge(
  p_voice_profile_id uuid,
  p_embedding        vector(1536),
  p_match_count      int default 3
)
returns table (content text, similarity float)
language sql stable as $$
  select content, 1 - (embedding <=> p_embedding) as similarity
  from knowledge_base
  where voice_profile_id = p_voice_profile_id
    and embedding is not null
  order by embedding <=> p_embedding
  limit p_match_count;
$$;

-- ══════════════════════════════════════════════════════════════
-- AUTO TRIGGERS
-- ══════════════════════════════════════════════════════════════

-- Auto-create tenant on user signup
--
-- BUGFIX (found live, 2026-07-02): this function is `security definer`,
-- which means it does NOT automatically inherit the caller's search_path —
-- it uses whatever search_path was in effect at function-creation time
-- (often just pg_catalog/pg_temp for definer functions on Supabase). That
-- caused every real signup to fail with `42P01: relation "tenants" does
-- not exist` even though public.tenants exists and works fine everywhere
-- else. Fixed two ways for defense-in-depth: explicit `public.` schema
-- qualification on every table reference, AND an explicit search_path set
-- on the function itself.
create or replace function handle_new_user()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_biz_name  text;
begin
  v_biz_name := coalesce(
    new.raw_user_meta_data->>'business_name',
    split_part(new.email, '@', 1)
  );

  insert into public.tenants (name, plan, status, owner_id, trial_ends_at)
  values (v_biz_name, 'trial', 'trial', new.id, now() + interval '14 days')
  returning id into v_tenant_id;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (v_tenant_id, new.id, 'owner');

  insert into public.call_minutes (tenant_id, month, used_seconds, plan_limit_seconds)
  values (v_tenant_id, to_char(now(), 'YYYY-MM'), 0, 12000);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- Auto-update updated_at timestamps
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tenants_updated_at        on tenants;
drop trigger if exists voice_profiles_updated_at on voice_profiles;
drop trigger if exists calls_updated_at          on calls;
drop trigger if exists appointments_updated_at   on appointments;
drop trigger if exists subscriptions_updated_at  on subscriptions;

create trigger tenants_updated_at        before update on tenants        for each row execute procedure set_updated_at();
create trigger voice_profiles_updated_at before update on voice_profiles for each row execute procedure set_updated_at();
create trigger calls_updated_at          before update on calls          for each row execute procedure set_updated_at();
create trigger appointments_updated_at   before update on appointments   for each row execute procedure set_updated_at();
create trigger subscriptions_updated_at  before update on subscriptions  for each row execute procedure set_updated_at();

-- ══════════════════════════════════════════════════════════════
-- INDEXES (performance)
-- ══════════════════════════════════════════════════════════════
create index if not exists idx_calls_tenant_created    on calls(tenant_id, created_at desc);
create index if not exists idx_calls_status            on calls(status);
create index if not exists idx_calls_voice_profile     on calls(voice_profile_id);
create index if not exists idx_calls_intent            on calls(intent);
create index if not exists idx_appts_tenant            on appointments(tenant_id, created_at desc);
create index if not exists idx_appts_slot              on appointments(slot_date, slot_time);
create index if not exists idx_wa_log_tenant           on wa_dispatch_log(tenant_id, sent_at desc);
create index if not exists idx_vp_tenant               on voice_profiles(tenant_id);
create index if not exists idx_vp_did                  on voice_profiles(did_number);
create index if not exists idx_kb_profile              on knowledge_base(voice_profile_id);
create index if not exists idx_campaigns_tenant        on campaigns(tenant_id);
create index if not exists idx_campaign_contacts_camp  on campaign_contacts(campaign_id);
create index if not exists idx_audit_created           on admin_audit_log(created_at desc);
create index if not exists idx_call_minutes_tenant     on call_minutes(tenant_id, month);

-- Vector index for fast RAG search
create index if not exists idx_kb_embedding on knowledge_base using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ══════════════════════════════════════════════════════════════
-- STORAGE BUCKETS
-- ══════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('call-recordings', 'call-recordings', false, 52428800, array['audio/wav','audio/mpeg','audio/ogg','audio/webm']),
  ('knowledge-docs',  'knowledge-docs',  false, 10485760, array['application/pdf','text/plain','text/csv'])
on conflict (id) do nothing;

-- Storage RLS: tenants can only access their own files
create policy "recordings_tenant_access" on storage.objects for all
  using (bucket_id = 'call-recordings' and (storage.foldername(name))[1] = get_my_tenant_id()::text)
  with check (bucket_id = 'call-recordings' and (storage.foldername(name))[1] = get_my_tenant_id()::text);

create policy "docs_tenant_access" on storage.objects for all
  using (bucket_id = 'knowledge-docs' and (storage.foldername(name))[1] = get_my_tenant_id()::text)
  with check (bucket_id = 'knowledge-docs' and (storage.foldername(name))[1] = get_my_tenant_id()::text);

-- ══════════════════════════════════════════════════════════════
-- DONE
-- Nikki — Telugu AI Receptionist
-- Powered by Nikki Tech Labs
-- © 2026 Nikki Technologies
-- ══════════════════════════════════════════════════════════════
