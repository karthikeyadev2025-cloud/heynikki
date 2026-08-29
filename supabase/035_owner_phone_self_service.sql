-- ══════════════════════════════════════════════════════════════
-- 035 — a customer can fix their own phone number
--
-- handle_new_user validates the phone captured at signup and stores NULL
-- when it fails (migration 030 added that check after an 11-digit number
-- produced a wrong last-10). Sensible — except tenant_users has SELECT and
-- INSERT policies and no UPDATE policy at all, and the customer app has no
-- screen for it. So a tenant whose number was rejected could never supply
-- one, and every feature keyed on it stayed dead for them forever: the
-- whole onboarding WhatsApp sequence, the missed-call guard's ring group,
-- and the test call.
--
-- The live tenant "riya" is in exactly this state right now — phone NULL
-- since signup, with no way to fix it from inside the product.
--
-- Scope is deliberately narrow: a user may update THEIR OWN row only. The
-- role column is protected by a trigger below, so this cannot be used to
-- self-promote to owner or super_admin — that was the reason there was no
-- update policy in the first place, and it is a real risk, not a
-- hypothetical one.
-- ══════════════════════════════════════════════════════════════

drop policy if exists tu_update_self on tenant_users;
create policy tu_update_self on tenant_users for update
  using (user_id = auth.uid() or is_super_admin())
  with check (user_id = auth.uid() or is_super_admin());

create or replace function guard_tenant_user_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A super admin may change anything. Anyone else keeps the role and the
  -- tenant they already had, no matter what the UPDATE claimed.
  if is_super_admin() then
    return new;
  end if;
  new.role      := old.role;
  new.tenant_id := old.tenant_id;
  new.user_id   := old.user_id;
  return new;
end;
$$;

drop trigger if exists trg_guard_tenant_user_role on tenant_users;
create trigger trg_guard_tenant_user_role
  before update on tenant_users
  for each row execute function guard_tenant_user_role();

comment on policy tu_update_self on tenant_users is
  'A member may edit their own row; role/tenant/user are pinned by trigger.';
