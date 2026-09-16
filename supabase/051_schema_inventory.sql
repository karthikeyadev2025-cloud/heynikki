-- ══════════════════════════════════════════════════════════════
-- 051 — SCHEMA INVENTORY (for scripts/schema-drift.mjs)
--
-- The drift script compares what supabase/*.sql declares against what the
-- live database actually has. It reached the database over PostgREST, which
-- can ask "does this table have this column" (select … limit 1) and nothing
-- else — pg_policy, pg_indexes and pg_proc are in pg_catalog and PostgREST
-- does not expose them.
--
-- So it checked 46 tables and 106 columns, and was blind to 440 further
-- columns (any declared inline in a CREATE TABLE body rather than added by
-- a later ALTER), 102 RLS policies, 102 functions and 142 indexes.
--
-- That blindness had already cost something. The script's own header names
-- the two failures it was written for, and it could only ever have caught
-- one of them: migration 013's missing columns, yes — but the kyc-documents
-- bucket having RLS with no policy, no, because policies were not checked.
-- The report that was supposed to catch both could structurally only catch
-- half.
--
-- This function is the other half: one round trip that returns every object
-- name in the public schema, which the script then compares against what the
-- migrations declare.
--
-- SECURITY. It returns object NAMES, never row data, so it leaks schema
-- shape and nothing else — and anyone holding the service key can read the
-- schema anyway. Even so, execute is revoked from anon and authenticated so
-- a browser session cannot enumerate the schema; only service_role, which
-- the drift script uses, may call it.
-- ══════════════════════════════════════════════════════════════

create or replace function public.schema_inventory()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select coalesce(jsonb_agg(ident order by ident), '[]'::jsonb) from (
    -- Tables
    select 'table:' || c.relname as ident
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')

    union all
    -- Columns, including the ones declared inline in a CREATE TABLE body,
    -- which is the bulk of what was invisible before.
    select 'column:' || c.relname || '.' || a.attname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and a.attnum > 0 and not a.attisdropped

    union all
    -- RLS policies. The kyc-documents case: a table with RLS enabled and no
    -- policy denies everything, silently, and looks fine from the outside.
    select 'policy:' || c.relname || '.' || p.polname
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'

    union all
    -- Whether RLS is switched on at all, separately from whether any policy
    -- exists. Both matter and they fail differently: RLS off is a wide-open
    -- table, RLS on with no policy is a table nobody can read.
    select 'rls:' || c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity

    union all
    -- Functions and RPCs, by name only. Overloads collapse to one entry,
    -- which is what the script compares against.
    select distinct 'function:' || p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'

    union all
    select 'index:' || i.indexname from pg_indexes i where i.schemaname = 'public'

    union all
    select 'constraint:' || con.conname
      from pg_constraint con
      join pg_namespace n on n.oid = con.connamespace
     where n.nspname = 'public'

    union all
    select 'trigger:' || t.tgname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal
  ) s;
$$;

-- Schema shape is not for the browser to enumerate.
revoke all on function public.schema_inventory() from public;
revoke all on function public.schema_inventory() from anon;
revoke all on function public.schema_inventory() from authenticated;
grant execute on function public.schema_inventory() to service_role;

-- PostgREST caches the list of callable functions. Without this the RPC
-- 404s until the cache happens to refresh, which looks exactly like the
-- migration not having been applied.
notify pgrst, 'reload schema';
