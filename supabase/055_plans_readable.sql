-- The price catalogue nobody can read.
--
-- `plans` has row level security ENABLED with NO policy, which denies every
-- role except service_role. It is not in the enable-RLS block of 001, so it
-- was switched on out of band and the migrations never described the live
-- state. Proven: the same select returns [] with a user JWT and 4 rows with
-- the service key.
--
-- What that breaks, silently, for everyone:
--   - super-admin Pricing Engine: the plan grid is always empty, so no plan
--     can ever be edited.
--   - super-admin Revenue: planPrice() finds nothing, so Est. MRR and ARR
--     read ₹0 however many customers are paying.
--   - any dashboard page that wants to show what a plan includes.
--
-- These are public prices — the same figures the marketing pricing page
-- prints — so SELECT is open to everyone. Writes stay restricted to
-- super_admin (the panel edits plans through the API's service key anyway).
alter table public.plans enable row level security;

drop policy if exists "plans: anyone may read" on public.plans;
create policy "plans: anyone may read"
  on public.plans for select
  using (true);

drop policy if exists "plans: super admin writes" on public.plans;
create policy "plans: super admin writes"
  on public.plans for all
  using (public.is_super_admin())
  with check (public.is_super_admin());
