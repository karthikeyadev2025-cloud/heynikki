-- 008_fix_search_path_security_definer.sql
--
-- Fixes a real bug found live on 2026-07-02: `handle_new_user()` (the
-- auto-create-tenant-on-signup trigger) failed on every real signup with
-- `42P01: relation "tenants" does not exist` — even though public.tenants
-- exists and works fine everywhere else.
--
-- Root cause: `security definer` functions on Postgres do NOT automatically
-- inherit the calling session's search_path. They run with whatever
-- search_path was in effect at CREATE FUNCTION time (or Postgres/Supabase
-- defaults), which for functions invoked via internal triggers (like this
-- one, fired during an auth.users insert) can end up NOT including
-- `public` — so an unqualified `tenants` reference fails to resolve.
--
-- This wasn't limited to the signup trigger. Every other `security
-- definer` function in the schema had the same latent bug (unqualified
-- table references, no explicit search_path) — including
-- get_my_tenant_id() and is_super_admin(), which back nearly every RLS
-- policy in the app. Rather than wait to discover each one failing
-- individually the way handle_new_user() was discovered, all six are
-- fixed here the same way: explicit `public.` schema-qualification on
-- every table reference, plus an explicit `set search_path = public,
-- pg_temp` on the function itself.
--
-- (match_knowledge() is NOT included — it isn't `security definer`, so
-- it was never subject to this bug.)
--
-- Run this once, directly in the Supabase SQL Editor, against the live
-- database. This is a schema/function change — `git push` to the
-- voice-pipeline repo does NOT apply this; it only updates the source
-- files in supabase/001_schema.sql and 007_demo_tenants.sql so a FUTURE
-- fresh deploy doesn't regress. The live database needs this run directly.

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

create or replace function delete_expired_demo_tenants()
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.tenants where is_demo = true and demo_expires_at < now();
end; $$;
