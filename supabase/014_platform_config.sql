-- ============================================================
-- 014 — PLATFORM CONFIG (Super Admin singleton controls)
--
-- Single-row-per-key config store for platform-wide toggles:
--   telephony_engine : "freeswitch" | "exotel"
--   automation_engine: "n8n" | "activepieces"
--   n8n_url          : internal URL for n8n webhook base
--   activepieces_url : internal URL for activepieces webhook base
--   missed_call_guard: "true" | "false" (global default)
--
-- Super Admin can edit these from the dashboard without code changes.
-- Tenants cannot read or write this table (no RLS policy for tenant role).
-- ============================================================

create table if not exists platform_config (
  key        text primary key,
  value      text not null,
  label      text,                          -- Human-readable label for UI
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz default now()
);

-- Seed defaults
insert into platform_config (key, value, label) values
  ('telephony_engine',  'freeswitch',                         'Telephony Engine (freeswitch | exotel)'),
  ('automation_engine', 'n8n',                                'Automation Engine (n8n | activepieces)'),
  ('n8n_url',           'http://localhost:5678',               'n8n Internal Webhook Base URL'),
  ('activepieces_url',  'http://localhost:8080',               'Activepieces Internal Webhook Base URL'),
  ('missed_call_guard', 'true',                                'Global Missed Call Guard Default'),
  ('missed_call_seconds','20',                                 'Seconds before missed call fires'),
  ('sip_primary',       'jio',                                 'Primary SIP Trunk Provider (jio | vi)'),
  ('sip_failover',      'vi',                                  'Failover SIP Trunk Provider (jio | vi | none)'),
  ('r2_bucket',         'heynikki-recordings',                 'Cloudflare R2 Bucket Name'),
  ('r2_public_url',     '',                                    'Cloudflare R2 Public URL Base')
on conflict (key) do nothing;

-- RLS: only super_admin can read/write
alter table platform_config enable row level security;

create policy "super_admin_all" on platform_config
  for all using (is_super_admin())
  with check (is_super_admin());
