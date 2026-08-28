-- CRM: the people a lead is assigned to, and a stage list that is not tripled.
--
-- ── 1. tenant_users has no phone or name ─────────────────────────────
-- api-server/src/index.ts builds the human ring group with
--   select phone from tenant_users where tenant_id = ...
-- and that column has never existed. PostgREST answers 42703, the result is
-- null, the ring group comes out as an empty string, and a DID set to
-- routing_mode 'human' or 'hybrid' rings nobody at all. That is the Human CRM
-- Seat — a paid line item — failing silently.
--
-- display_name exists for the same reason from the other side: assigning a
-- lead to "a2f9c1d4-…" is not an assignment anyone can read. Both are
-- nullable; a seat with no phone simply drops out of the ring group, which is
-- the correct behaviour for someone who has not given one.
alter table tenant_users add column if not exists phone        text;
alter table tenant_users add column if not exists display_name text;

create index if not exists idx_tenant_users_tenant on tenant_users(tenant_id);

-- ── 2. Platform-default stages were inserted three times ─────────────
-- 017 seeds the five defaults with tenant_id = null and relies on
--   on conflict (tenant_id, name) do nothing
-- to stay idempotent. It does not: in SQL NULL is never equal to NULL, so the
-- unique constraint does not match an existing default row and every re-run
-- inserts the whole set again. The table holds 15 rows for 5 stages, and any
-- stage picker built on it lists "new" three times.
--
-- Keep the oldest row of each name, drop the rest.
delete from crm_pipeline_stages a
using crm_pipeline_stages b
where a.tenant_id is null
  and b.tenant_id is null
  and a.name = b.name
  and a.ctid > b.ctid;

-- Stop it recurring. A partial unique index over name alone covers exactly
-- the platform-default rows, where the (tenant_id, name) constraint cannot.
-- Tenant-owned rows keep using that original constraint.
create unique index if not exists crm_pipeline_stages_default_name_key
  on crm_pipeline_stages (name)
  where tenant_id is null;
