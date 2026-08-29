-- ══════════════════════════════════════════════════════════════
-- 025 — TRIAL CREDITS
--
-- Replaces the demo. A new business gets 100 credits, one credit is one
-- minute of talk time, and they spend it on real calls on a real number
-- rather than on a sandbox that proves nothing. At the measured cost of
-- ~Rs 1.37 per minute that is about Rs 137 of our money per signup, which
-- is the whole point: it is cheaper than a sales call and it is the
-- product doing the selling.
--
-- Two structures, deliberately:
--
--   tenants.credit_minutes  the balance, read on every inbound call, so
--                           it has to be one indexed lookup and not a
--                           sum over history.
--   credit_ledger           every grant and every deduction, with the
--                           call that caused it. A balance nobody can
--                           explain is a support ticket nobody can close,
--                           and "why did my free minutes disappear" is
--                           the first question a trial user asks.
--
-- The ledger is the truth; the balance is a cache of it. They are kept in
-- step by the trigger below rather than by application code, because
-- three different services write calls and only one of them would have
-- remembered.
-- ══════════════════════════════════════════════════════════════

-- Default 0, NOT 100. The grant is a ledger row, and if the column also
-- defaulted to 100 the backfill below would add a second 100 on top of it
-- and every existing tenant would show 200.
alter table tenants
  add column if not exists credit_minutes numeric(10,2) not null default 0;

create table if not exists credit_ledger (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  -- Positive grants, negative spends. Never rewritten — a correction is
  -- another row, so the history stays auditable.
  delta       numeric(10,2) not null,
  reason      text not null,
  call_id     uuid references calls(id) on delete set null,
  balance_after numeric(10,2),
  created_at  timestamptz not null default now()
);

create index if not exists credit_ledger_tenant_idx
  on credit_ledger(tenant_id, created_at desc);

-- One deduction per call. A hangup webhook that fires twice — and Meta,
-- FreeSWITCH and the scheduler have all delivered something twice today —
-- must not bill the minute twice.
create unique index if not exists credit_ledger_call_key
  on credit_ledger(call_id) where call_id is not null;

alter table credit_ledger enable row level security;

drop policy if exists credit_ledger_select_own on credit_ledger;
create policy credit_ledger_select_own on credit_ledger
  for select using (tenant_id = get_my_tenant_id() or is_super_admin());

-- Only the platform writes credit. A tenant that could insert here could
-- grant itself minutes.
drop policy if exists credit_ledger_admin_write on credit_ledger;
create policy credit_ledger_admin_write on credit_ledger
  for all using (is_super_admin()) with check (is_super_admin());

-- Balance follows the ledger, always.
create or replace function apply_credit_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Not clamped at zero on purpose. A call already in progress when the
  -- balance runs out finishes, so the last deduction can push it slightly
  -- negative — and that is the truth. Clamping would make the balance
  -- disagree with the sum of its own ledger, which is the one property
  -- that makes this table worth having.
  update tenants
     set credit_minutes = credit_minutes + new.delta
   where id = new.tenant_id
   returning credit_minutes into new.balance_after;
  return new;
end $$;

drop trigger if exists credit_ledger_apply on credit_ledger;
create trigger credit_ledger_apply
  before insert on credit_ledger
  for each row execute function apply_credit_ledger();

-- Every new signup gets the grant. Done in the database rather than in the
-- signup handler because the tenant row is created by the handle_new_user
-- trigger on auth.users, so there is no application code path that reliably
-- runs once per new tenant.
create or replace function grant_signup_credits()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into credit_ledger (tenant_id, delta, reason)
  values (new.id, 100, 'signup_grant');
  return new;
end $$;

drop trigger if exists tenants_grant_credits on tenants;
create trigger tenants_grant_credits
  after insert on tenants
  for each row execute function grant_signup_credits();

-- Existing tenants signed up before credits existed.
insert into credit_ledger (tenant_id, delta, reason)
select id, 100, 'signup_grant_backfill' from tenants
where not exists (
  select 1 from credit_ledger l where l.tenant_id = tenants.id
);

comment on column tenants.credit_minutes is
  'Trial/prepaid balance in minutes. Cache of credit_ledger, maintained by trigger.';
