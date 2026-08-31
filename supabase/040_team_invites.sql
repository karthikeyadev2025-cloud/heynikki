-- ══════════════════════════════════════════════════════════════
-- 040 — a business can add its own people
--
-- Roles became real in 039: only an owner may change the greeting, the price
-- floor, or start a campaign that spends money. That rule was written about a
-- person the business had no way to add. There has never been an invite flow
-- — only a super admin could attach anyone to a tenant — so every account was
-- a single operator, and the "CRM seats" line had to come off the pricing
-- page because nobody could use it.
--
-- The seat cap lives on the plan so it is sold and enforced from the same
-- row as everything else. Starter is genuinely one person; a clinic with a
-- receptionist and a doctor is the Growth case.
-- ══════════════════════════════════════════════════════════════

alter table plans
  add column if not exists max_seats integer not null default 1;

update plans set max_seats = 1  where id in ('trial', 'starter');
update plans set max_seats = 3  where id = 'growth';
update plans set max_seats = 10 where id = 'scale';

create table if not exists tenant_invites (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  email       text not null,
  role        text not null default 'member'
              check (role in ('member', 'support')),
  -- The secret in the link. Long, random, and unique so a guessed value
  -- cannot join someone to a business they were never invited to.
  token       text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by  uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  -- An invite that lives forever is a credential nobody remembers issuing.
  expires_at  timestamptz not null default now() + interval '14 days',
  created_at  timestamptz not null default now()
);

-- One live invite per email per business. Re-inviting replaces rather than
-- accumulating links that all still work.
create unique index if not exists tenant_invites_pending_key
  on tenant_invites(tenant_id, lower(email)) where accepted_at is null;
create index if not exists tenant_invites_tenant on tenant_invites(tenant_id);

alter table tenant_invites enable row level security;

-- Only the business's owner manages its invites. The accept path does NOT
-- read through RLS — it arrives with a token and no session yet, and is
-- served by the API on the service key.
drop policy if exists invites_owner on tenant_invites;
create policy invites_owner on tenant_invites for all
  using ((tenant_id = get_my_tenant_id() and is_tenant_owner()) or is_super_admin())
  with check ((tenant_id = get_my_tenant_id() and is_tenant_owner()) or is_super_admin());

-- Members may see who else is on the team; only an owner changes it.
drop policy if exists tu_select_team on tenant_users;
create policy tu_select_team on tenant_users for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());

comment on table tenant_invites is
  'Pending team invitations. The token is the credential in the invite link.';
