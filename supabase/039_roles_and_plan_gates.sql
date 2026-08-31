-- ══════════════════════════════════════════════════════════════
-- 039 — roles that mean something
--
-- tenant_users has carried role since the first schema — owner, member,
-- support, super_admin — and until now the only one that changed anything
-- was super_admin. Every policy on every tenant table asked the same
-- question: are you in this tenant? So a member could do whatever the owner
-- could.
--
-- That was survivable while the product only stored calls. It stopped being
-- survivable when the profile started carrying money decisions: a member
-- could set the negotiation floor to a rupee, rewrite the greeting, or start
-- an outbound campaign that dials a thousand numbers at the business's
-- expense. None of that is a receptionist's job, and none of it should need
-- a support ticket to undo.
--
-- The split is about consequence, not seniority. Anyone on the team works
-- leads, calls and appointments — that IS the job. Only an owner changes
-- what the business says, what it charges, and what it spends.
-- ══════════════════════════════════════════════════════════════

create or replace function my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from tenant_users where user_id = auth.uid() limit 1;
$$;

comment on function my_role is
  'The caller''s role in their tenant. Used by policies that gate money and identity.';

create or replace function is_tenant_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(my_role() in ('owner', 'super_admin'), false);
$$;

-- ── The agent's identity, hours, script and PRICE FLOOR ──────────────
-- Reading stays open to the whole team: staff need to know the hours they
-- are quoting. Writing does not.
drop policy if exists "vp_insert" on voice_profiles;
drop policy if exists "vp_update" on voice_profiles;
drop policy if exists "vp_delete" on voice_profiles;

create policy "vp_insert" on voice_profiles for insert
  with check (tenant_id = get_my_tenant_id() and is_tenant_owner());
create policy "vp_update" on voice_profiles for update
  using (tenant_id = get_my_tenant_id() and is_tenant_owner())
  with check (tenant_id = get_my_tenant_id() and is_tenant_owner());
create policy "vp_delete" on voice_profiles for delete
  using ((tenant_id = get_my_tenant_id() and is_tenant_owner()) or is_super_admin());

-- ── Spending the business's money ────────────────────────────────────
-- An outbound campaign places real calls that cost real minutes. Creating
-- and starting one is an owner's decision.
drop policy if exists "campaigns: tenant members" on outbound_campaigns;
drop policy if exists campaigns_read on outbound_campaigns;
drop policy if exists campaigns_write on outbound_campaigns;

create policy campaigns_read on outbound_campaigns for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());
create policy campaigns_write on outbound_campaigns for all
  using ((tenant_id = get_my_tenant_id() and is_tenant_owner()) or is_super_admin())
  with check ((tenant_id = get_my_tenant_id() and is_tenant_owner()) or is_super_admin());

-- ── Deliberately NOT restricted ──────────────────────────────────────
-- Adding someone to the do-not-call list is a safety-positive act with a
-- legal obligation behind it. Anyone who hears "stop calling me" must be
-- able to honour it immediately, without finding the owner first. Leads,
-- calls and appointments stay open to the whole team for the same reason:
-- that is the work.
