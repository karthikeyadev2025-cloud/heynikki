-- Realtime was never switched on for any table: the dashboard subscribes
-- to postgres_changes on calls and appointments, and no migration ever
-- added them to the publication, so the subscription fired for nothing and
-- the 30-second poll did all the work. Add the two tables the dashboard
-- listens to. RLS still applies to what each subscriber receives.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'calls'
  ) then
    alter publication supabase_realtime add table public.calls;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'appointments'
  ) then
    alter publication supabase_realtime add table public.appointments;
  end if;
end $$;

-- The Human Desk lists a tenant's transferred/missed inbound calls for the
-- last week, and the hangup hook closes click_to_call_log by channel uuid.
create index if not exists calls_tenant_status_created_idx
  on public.calls (tenant_id, status, created_at desc);
create index if not exists click_to_call_log_fs_uuid_idx
  on public.click_to_call_log (freeswitch_uuid);
