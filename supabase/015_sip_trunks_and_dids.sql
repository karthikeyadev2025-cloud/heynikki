-- ============================================================
-- 015 — SIP TRUNKS
--
-- Stores Jio & Vi enterprise SIP trunk connection credentials.
-- FreeSWITCH reads these at startup / on reload to configure
-- gateway profiles dynamically.
--
-- Security: credentials are stored encrypted (pgcrypto AES-256).
-- The decryption key is the SUPABASE_ENCRYPTION_KEY env var,
-- never stored in the database.
-- ============================================================

create table if not exists sip_trunks (
  id               uuid primary key default gen_random_uuid(),
  provider         text not null
                   check (provider in ('jio', 'vi', 'exotel', 'plivo', 'twilio')),
  display_name     text not null,             -- e.g. "Jio Enterprise Primary"
  host             text not null,             -- SIP gateway hostname/IP
  port             integer default 5060,
  username         text not null,             -- SIP auth username
  password_enc     text not null,             -- AES-256 encrypted password
  realm            text,                      -- SIP realm/domain (if different from host)
  transport        text default 'udp'
                   check (transport in ('udp', 'tcp', 'tls')),
  priority         integer default 1,         -- 1 = primary, 2 = secondary/failover
  status           text default 'active'
                   check (status in ('active', 'standby', 'disabled', 'error')),
  concurrent_calls integer default 30,        -- max concurrent channels on this trunk
  calls_per_second integer default 5,         -- CPS limit (anti-fraud)
  inbound_did_prefix text,                    -- prefix to strip from inbound DID
  codec_list       text[] default array['PCMU','PCMA'],
  last_registered_at timestamptz,
  last_error       text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- Seed Jio primary + Vi failover (fill real credentials via Super Admin)
insert into sip_trunks (provider, display_name, host, port, username, password_enc, priority, status) values
  ('jio', 'Jio Enterprise SIP — Primary',  'siptrunk.jio.com',    5060, 'jio_username_here',  'PLACEHOLDER_ENCRYPT_ME', 1, 'disabled'),
  ('vi',  'Vi Business SIP — Failover',    'sip.vibusiness.in',   5060, 'vi_username_here',   'PLACEHOLDER_ENCRYPT_ME', 2, 'disabled')
on conflict do nothing;

-- RLS: only super_admin
alter table sip_trunks enable row level security;

create policy "super_admin_all_sip" on sip_trunks
  for all using (is_super_admin())
  with check (is_super_admin());

-- ============================================================
-- 016 — DID MANAGEMENT
--
-- Maps virtual phone numbers (DIDs) to tenants + voice profiles.
-- Each DID is assigned to exactly one tenant at a time.
-- FreeSWITCH dialplan routes based on the `number` field.
-- ============================================================

create table if not exists dids (
  id                 uuid primary key default gen_random_uuid(),
  number             text not null unique,     -- E.164 format: +917XXXXXXXXX
  display_number     text,                     -- formatted for UI: 97XXXXXXXX
  sip_trunk_id       uuid references sip_trunks(id) on delete set null,
  tenant_id          uuid references tenants(id) on delete set null,
  voice_profile_id   uuid references voice_profiles(id) on delete set null,
  provider           text not null default 'jio'
                     check (provider in ('jio', 'vi', 'exotel', 'plivo', 'twilio')),
  monthly_cost_paise integer default 199900,   -- ₹1,999/month
  status             text default 'available'
                     check (status in ('available', 'assigned', 'suspended', 'porting')),
  -- Routing config per DID
  routing_mode       text default 'ai'
                     check (routing_mode in ('ai', 'human', 'hybrid', 'ivr')),
  missed_call_guard  boolean default true,
  fallback_message   text default 'Thank you for calling. All our representatives are busy. We will call you back shortly.',
  -- Audit
  assigned_at        timestamptz,
  released_at        timestamptz,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- RLS: super admin sees all; tenant sees only their DIDs
alter table dids enable row level security;

create policy "super_admin_all_dids" on dids
  for all using (is_super_admin())
  with check (is_super_admin());

create policy "tenant_read_own_dids" on dids
  for select using (
    tenant_id = get_my_tenant_id()
  );

-- Update voice_profiles to reference dids table going forward
-- (did_number text column kept for backward compat, dids table is source of truth)

-- Update phone_numbers provider enum to include freeswitch providers
alter table phone_numbers
  drop constraint if exists phone_numbers_provider_check;

alter table phone_numbers
  add constraint phone_numbers_provider_check
  check (provider in ('jio', 'vi', 'exotel', 'plivo', 'twilio'));
