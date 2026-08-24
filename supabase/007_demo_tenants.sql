-- ────────────────────────────────────────────────────────
-- 007_demo_tenants.sql — Demo flow on heynikki.in/demo
-- ────────────────────────────────────────────────────────

alter table tenants drop constraint if exists tenants_plan_check;
alter table tenants add constraint tenants_plan_check
  check (plan in ('demo','trial','starter','growth','scale'));

alter table tenants add column if not exists is_demo         boolean not null default false;
alter table tenants add column if not exists demo_phone      text;
alter table tenants add column if not exists demo_expires_at timestamptz;
alter table tenants add column if not exists business_type   text;
alter table tenants add column if not exists greeting_text   text;
alter table tenants add column if not exists voice_profile   text default 'anushka';
alter table tenants add column if not exists language        text default 'te-IN';

create index if not exists tenants_demo_phone_idx
  on tenants (demo_phone)
  where is_demo = true;

create or replace function delete_expired_demo_tenants()
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.tenants where is_demo = true and demo_expires_at < now();
end; $$;
