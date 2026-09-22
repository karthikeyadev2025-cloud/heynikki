-- ══════════════════════════════════════════════════════════════
-- 061 — telecaller shifts and daily targets
--
-- Four telecallers are about to work the Human Desk together, and nothing
-- recorded when anyone was working or what a day's work was meant to be. The
-- call log says what was dialled; it cannot say whether a quiet seat was idle
-- or simply not on shift, and "is 12 calls a good day" had no answer.
--
-- seat_attendance: one row per shift. A person checks in and out on the Desk.
--   At most one open shift per person per business, enforced here and not
--   only in the API, so a double-click or two open tabs cannot start two.
--   A shift nobody closed is closed by the API at the end of that IST day
--   (or 12 hours in, whichever is first) with auto_closed = true, so a
--   forgotten check-out cannot bill a telecaller for a night asleep.
--
-- seat_targets: what a day's work is, per person, set by the owner.
--   0 means "no target", not "zero is the target".
--
-- Writes go through the API on the service key (it enforces who may check
-- whom in and who may set targets). RLS only decides who may READ.
-- ══════════════════════════════════════════════════════════════

create table if not exists seat_attendance (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  check_in_at  timestamptz not null default now(),
  check_out_at timestamptz,
  auto_closed  boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint seat_attendance_out_after_in
    check (check_out_at is null or check_out_at >= check_in_at)
);

create unique index if not exists seat_attendance_one_open
  on seat_attendance(tenant_id, user_id) where check_out_at is null;
create index if not exists seat_attendance_tenant_day
  on seat_attendance(tenant_id, check_in_at desc);

alter table seat_attendance enable row level security;

-- A person sees their own shifts; the owner sees the team's.
drop policy if exists attendance_read on seat_attendance;
create policy attendance_read on seat_attendance for select
  using ((tenant_id = get_my_tenant_id() and (user_id = auth.uid() or is_tenant_owner()))
         or is_super_admin());


create table if not exists seat_targets (
  tenant_id           uuid not null references tenants(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  daily_calls         integer not null default 0 check (daily_calls between 0 and 1000),
  daily_conversations integer not null default 0 check (daily_conversations between 0 and 1000),
  updated_by          uuid references auth.users(id) on delete set null,
  updated_at          timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

alter table seat_targets enable row level security;

-- The whole team may see targets; only the owner sets them (via the API).
drop policy if exists targets_read on seat_targets;
create policy targets_read on seat_targets for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());
