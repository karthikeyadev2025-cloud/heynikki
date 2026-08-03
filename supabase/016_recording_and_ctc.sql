-- ============================================================
-- 016 — RECORDING STORAGE PROVIDER + MISSED CALL CONFIG
--
-- Extends calls table with R2 storage fields.
-- Extends voice_profiles with missed call guard config.
-- ============================================================

-- Add storage provider tracking to calls
alter table calls
  add column if not exists storage_provider text default 'r2'
    check (storage_provider in ('r2', 'supabase', 's3')),
  add column if not exists r2_object_key text,         -- R2 object path for purge/manage
  add column if not exists recording_size_bytes integer; -- for storage analytics

-- Add missed call guard config to voice_profiles
alter table voice_profiles
  add column if not exists missed_call_guard_enabled  boolean default true,    -- UI uses this
  add column if not exists missed_call_guard           boolean default true,    -- legacy compat
  add column if not exists missed_call_guard_seconds  integer default 20,
  add column if not exists missed_call_seconds        integer default 20,       -- legacy compat
  add column if not exists fallback_message           text    default 'Thank you for calling. All our representatives are busy. We will call you back shortly.',
  add column if not exists fallback_wa_enabled        boolean default true,
  add column if not exists fallback_wa_template       text    default 'missed_call_followup',
  add column if not exists routing_mode               text    default 'ai'
    check (routing_mode in ('ai', 'human', 'hybrid')),
  -- Click-to-Call masking
  add column if not exists caller_id_number           text,   -- the Jio DID shown to outbound callees
  -- n8n / Activepieces webhook overrides per profile (null = use platform default)
  add column if not exists automation_webhook_url     text;

-- Add R2 URL column to calls (populated after recording upload)
alter table calls
  add column if not exists recording_url text;

-- ============================================================
-- CLICK-TO-CALL LOG
--
-- Tracks human-initiated outbound calls from the dashboard.
-- Separate from campaigns (those are AI-dialed batches).
-- ============================================================

create table if not exists click_to_call_log (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references tenants(id) on delete cascade,
  agent_user_id    uuid references auth.users(id) on delete set null,
  lead_id          uuid references leads(id) on delete set null,
  caller_number    text not null,             -- agent's internal number / DID
  callee_number    text not null,             -- customer's number
  masked_cli       text,                      -- Jio DID shown to customer
  call_id          uuid references calls(id) on delete set null,
  freeswitch_uuid  text,                      -- FS channel UUID for ESL control
  disposition      text
                   check (disposition in ('interested','not_interested','booked','callback','no_answer','busy','failed')),
  notes            text,
  duration_seconds integer default 0,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

alter table click_to_call_log enable row level security;

create policy "tenant_own_ctc" on click_to_call_log
  for all using (tenant_id = get_my_tenant_id())
  with check (tenant_id = get_my_tenant_id());

create policy "super_admin_all_ctc" on click_to_call_log
  for all using (is_super_admin())
  with check (is_super_admin());

-- ============================================================
-- WHATSAPP TEMPLATES
--
-- Pre-approved Meta WhatsApp template registry per tenant.
-- ============================================================

create table if not exists wa_templates (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references tenants(id) on delete cascade,
  name             text not null,             -- Meta template name
  category         text not null
                   check (category in ('utility','marketing','authentication')),
  language         text default 'te',
  body_text        text not null,
  variables        text[] default array[]::text[], -- {{1}}, {{2}} placeholders
  status           text default 'pending'
                   check (status in ('pending','approved','rejected')),
  meta_template_id text,                      -- Meta's assigned template ID
  created_at       timestamptz default now()
);

alter table wa_templates enable row level security;

create policy "tenant_own_wa_templates" on wa_templates
  for all using (tenant_id = get_my_tenant_id())
  with check (tenant_id = get_my_tenant_id());

create policy "super_admin_all_wa_templates" on wa_templates
  for all using (is_super_admin())
  with check (is_super_admin());

-- Seed common templates
insert into wa_templates (tenant_id, name, category, language, body_text, variables, status) values
  (null, 'missed_call_followup', 'utility', 'te',
   'నమస్కారం! మీరు {{1}} కి call చేశారు. మేము ఇప్పుడు busy గా ఉన్నాం. మీకు తిరిగి call చేస్తాం. లేదా మీ requirement WhatsApp లో type చేయండి.',
   array['business_name'], 'approved'),
  (null, 'appointment_confirmed', 'utility', 'te',
   'మీ appointment confirm అయింది! 📅 Date: {{1}} | Time: {{2}} | Service: {{3}}. మరిన్ని details కి reply చేయండి.',
   array['date','time','service'], 'approved'),
  (null, 'brochure_send', 'utility', 'te',
   'నమస్కారం {{1}} గారు! మీరు request చేసిన brochure పంపుతున్నాం. దయచేసి చూడండి. Questions ఏమైనా ఉంటే reply చేయండి! 🙏',
   array['name'], 'approved')
on conflict do nothing;
