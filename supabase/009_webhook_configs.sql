-- 009_webhook_configs.sql
--
-- Outbound webhooks — the honest, buildable version of "CRM integration."
-- Instead of guessing which named CRM to build first (Salesforce? HubSpot?
-- something else entirely?), any tenant can point ANY tool that accepts
-- webhooks (Zapier, Make, n8n, their own backend) at Jovio and receive
-- events as they happen.
--
-- Only `call.completed` is a real event today — see the comment block in
-- voice-pipeline/app/exotel/webhooks.py for why `appointment.created`
-- isn't included yet (there's no appointment-booking step in the live
-- pipeline to fire it from).

create table if not exists webhook_configs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid references tenants(id) on delete cascade,
  url            text not null,
  secret         text not null,  -- HMAC-SHA256 signing key, tenant-generated
  events         text[] not null default array['call.completed'],
  active         boolean not null default true,
  created_at     timestamptz default now(),
  last_fired_at  timestamptz,
  last_status_code integer
);

alter table webhook_configs enable row level security;

drop policy if exists "webhook_select" on webhook_configs;
drop policy if exists "webhook_insert" on webhook_configs;
drop policy if exists "webhook_update" on webhook_configs;
drop policy if exists "webhook_delete" on webhook_configs;

create policy "webhook_select" on webhook_configs for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "webhook_insert" on webhook_configs for insert
  with check (tenant_id = get_my_tenant_id());
create policy "webhook_update" on webhook_configs for update
  using (tenant_id = get_my_tenant_id());
create policy "webhook_delete" on webhook_configs for delete
  using (tenant_id = get_my_tenant_id());
