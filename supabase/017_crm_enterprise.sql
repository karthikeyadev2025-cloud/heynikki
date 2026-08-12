-- ══════════════════════════════════════════════════════════════
-- 017 — ENTERPRISE CRM
--
-- Extends the leads table (011_leads_crm.sql) from a simple honest
-- funnel into a full enterprise CRM, per explicit super-admin request:
-- lead assignment, custom pipeline stages, deal value tracking, an
-- activity timeline, and tags. This deliberately reverses 011's own
-- design note ("NOT a configurable pipeline builder") — noted here so
-- the history is clear, not silently contradicted.
-- ══════════════════════════════════════════════════════════════

-- ── Custom pipeline stages ──────────────────────────────────
-- Replacing the hardcoded CHECK constraint (new/contacted/qualified/
-- won/lost) with a real, editable stage list stored here. Each row is
-- one stage; tenant_id NULL means it's a platform-wide default stage
-- available to every tenant unless they define their own.
alter table leads drop constraint if exists leads_stage_check;

create table if not exists crm_pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references tenants(id) on delete cascade,  -- null = platform default
  name        text not null,
  color       text,                 -- hex, matches the super-admin palette conventions
  sort_order  integer not null default 0,
  created_at  timestamptz default now(),
  unique (tenant_id, name)
);

insert into crm_pipeline_stages (tenant_id, name, color, sort_order) values
  (null, 'new',        '#06B6D4', 0),
  (null, 'contacted',  '#F59E0B', 1),
  (null, 'qualified',  '#1D6FA5', 2),
  (null, 'won',        '#10B981', 3),
  (null, 'lost',       '#94A3B8', 4)
on conflict (tenant_id, name) do nothing;

alter table crm_pipeline_stages enable row level security;
drop policy if exists "crm_pipeline_stages_select" on crm_pipeline_stages;
drop policy if exists "crm_pipeline_stages_write"  on crm_pipeline_stages;
create policy "crm_pipeline_stages_select" on crm_pipeline_stages for select
  using (tenant_id is null or tenant_id = get_my_tenant_id() or is_super_admin());
create policy "crm_pipeline_stages_write" on crm_pipeline_stages for all
  using (is_super_admin()) with check (is_super_admin());

-- ── Lead extensions ──────────────────────────────────────────
alter table leads add column if not exists assigned_to      uuid references auth.users(id) on delete set null;
alter table leads add column if not exists deal_value_paise integer default 0;
alter table leads add column if not exists tags             text[] default '{}';

create index if not exists idx_leads_assigned_to on leads(assigned_to);
create index if not exists idx_leads_tags        on leads using gin(tags);

-- ── Activity timeline ────────────────────────────────────────
-- One row per event on a lead: stage change, note, assignment,
-- call — a real audit trail, not just a single "notes" text field.
create table if not exists lead_activities (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references leads(id) on delete cascade,
  type        text not null check (type in ('note','stage_change','assignment','call','tag_change','value_change')),
  description text not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz default now()
);

create index if not exists idx_lead_activities_lead_id on lead_activities(lead_id, created_at desc);

alter table lead_activities enable row level security;
drop policy if exists "lead_activities_select" on lead_activities;
drop policy if exists "lead_activities_insert" on lead_activities;
create policy "lead_activities_select" on lead_activities for select
  using (
    is_super_admin() or
    exists (select 1 from leads where leads.id = lead_activities.lead_id and leads.tenant_id = get_my_tenant_id())
  );
create policy "lead_activities_insert" on lead_activities for insert
  with check (
    is_super_admin() or
    exists (select 1 from leads where leads.id = lead_activities.lead_id and leads.tenant_id = get_my_tenant_id())
  );
