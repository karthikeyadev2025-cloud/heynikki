-- ============================================================
-- NIKKI — tenant API keys
-- ============================================================
-- Public REST API access is a Scale-plan feature. Each tenant can
-- issue multiple keys; we store ONLY the bcrypt hash + a short prefix
-- so even a database leak can't recover live keys.
--
-- Key format on issue: jvk_live_<random_32>  (or jvk_test_ for sandbox)
-- Hash format on store: bcrypt of the full key
-- Prefix stored separately: first 12 chars, for dashboard display
-- ============================================================

create table if not exists public.api_keys (
  id           uuid          primary key default uuid_generate_v4(),
  tenant_id    uuid          not null references public.tenants(id) on delete cascade,
  created_by   uuid          references auth.users(id) on delete set null,

  -- Display name set by the user (e.g. "Production CRM", "Zapier integration")
  name         text          not null,

  -- For showing in the dashboard: 'jvk_live_a3f2…' — never decryptable to full key
  prefix       text          not null,

  -- bcrypt hash of the FULL key. Compared via crypto.timingSafeEqual at auth.
  key_hash     text          not null,

  -- 'live' or 'test' — test keys hit sandbox endpoints (future)
  mode         text          not null default 'live'
                check (mode in ('live', 'test')),

  -- Scopes — JSON array of permitted action strings.
  -- Empty array = read-only access to calls/appointments only.
  -- ['calls.read', 'appointments.write', 'webhook.subscribe'] etc.
  scopes       jsonb         not null default '[]'::jsonb,

  -- Track usage for rate limiting + showing in dashboard
  last_used_at timestamptz,
  last_used_ip inet,
  request_count bigint       not null default 0,

  -- Optional expiry — null = never expires
  expires_at   timestamptz,

  -- Manual revocation (soft delete to keep audit trail)
  revoked_at   timestamptz,
  revoked_by   uuid          references auth.users(id) on delete set null,

  created_at   timestamptz   not null default now()
);

create index if not exists idx_api_keys_tenant_id on public.api_keys(tenant_id);
create index if not exists idx_api_keys_prefix    on public.api_keys(prefix);

-- ─── RLS ──────────────────────────────────────────────
alter table public.api_keys enable row level security;

-- Tenant members can list keys for their tenant — but key_hash is NEVER returned
-- to the client (the dashboard query selects everything except key_hash)
drop policy if exists "api_keys: tenant members can read" on public.api_keys;
create policy "api_keys: tenant members can read"
  on public.api_keys for select
  using (
    tenant_id in (
      select tenant_id from public.tenant_users where user_id = auth.uid()
    )
  );

-- Inserts and updates only happen via service-role key (server-side issuance flow).
-- No client-side INSERT/UPDATE policy.

comment on table public.api_keys is
  'Tenant-scoped API keys for the public REST API. Key plaintext is shown
   exactly once at issue; we store only the bcrypt hash and a display prefix.
   Revocation is soft (revoked_at) to preserve audit trail.';
