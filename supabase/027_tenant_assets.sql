-- ══════════════════════════════════════════════════════════════
-- 027 — WHAT THE CLIENT ALREADY HAS
--
-- Setup asks a business owner to type their services, their timings and
-- their appointment types into a form. Most of them already have all of
-- it — on a brochure, a price list, a menu, a clinic board photo. Asking
-- them to retype it is the reason /setup sits half-finished.
--
-- So: they upload what they have, and Nikki reads it. The extracted facts
-- go into knowledge_base, which already has an embedding job behind it, so
-- the agent can answer from the brochure on the next call. The structured
-- bits — services, hours, appointment types — become a DRAFT the owner
-- confirms.
--
-- A draft, not a direct write. A brochure listing "Mon-Sat 9-9" is
-- evidence, not instruction: if it were applied silently, a stale PDF
-- would quietly change when a business answers its phone, and nobody
-- would know why.
-- ══════════════════════════════════════════════════════════════

create table if not exists tenant_assets (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  -- What it is, so extraction knows what to look for. A logo needs no text
  -- extraction at all; a price list is mostly numbers.
  kind          text not null default 'brochure'
                check (kind in ('brochure','logo','price_list','menu','photo','other')),
  file_name     text,
  mime_type     text,
  size_bytes    integer,
  -- Object key in the private R2 bucket. No public URL column: these are
  -- customer business documents, fetched through a short-lived presigned
  -- URL the same way call recordings are.
  r2_object_key text,
  status        text not null default 'uploaded'
                check (status in ('uploaded','processing','processed','failed','skipped')),
  extracted     jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  processed_at  timestamptz
);

create index if not exists tenant_assets_tenant_idx on tenant_assets(tenant_id, created_at desc);
-- The processing job polls this.
create index if not exists tenant_assets_pending_idx on tenant_assets(status)
  where status in ('uploaded','processing');

alter table tenant_assets enable row level security;

-- A tenant sees and uploads its own files. Nobody sees anybody else's:
-- these are business documents, and a price list is commercially sensitive
-- even when it is printed on a leaflet.
drop policy if exists tenant_assets_own on tenant_assets;
create policy tenant_assets_own on tenant_assets
  for all using (tenant_id = get_my_tenant_id() or is_super_admin())
  with check (tenant_id = get_my_tenant_id() or is_super_admin());

-- ── The draft an owner confirms ─────────────────────────────────
create table if not exists profile_drafts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  source_asset  uuid references tenant_assets(id) on delete set null,
  -- Only the fields /setup collects. Whitelisted at write time too: a model
  -- reading a PDF should not be able to propose a change to a column that
  -- decides how calls are routed.
  proposed      jsonb not null,
  status        text not null default 'pending'
                check (status in ('pending','applied','dismissed')),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);

create index if not exists profile_drafts_pending_idx
  on profile_drafts(tenant_id, status) where status = 'pending';

alter table profile_drafts enable row level security;
drop policy if exists profile_drafts_own on profile_drafts;
create policy profile_drafts_own on profile_drafts
  for all using (tenant_id = get_my_tenant_id() or is_super_admin())
  with check (tenant_id = get_my_tenant_id() or is_super_admin());

comment on table tenant_assets is
  'Files a client uploads at onboarding. Read once, then their facts live in knowledge_base.';
comment on table profile_drafts is
  'Setup fields proposed from an uploaded document, awaiting the owner''s confirmation.';
