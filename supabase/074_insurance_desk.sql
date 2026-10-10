-- ══════════════════════════════════════════════════════════════
-- 074 — an insurance desk
--
-- 073 gave five kinds of business a desk of their own. An insurer, an
-- insurance agency or a broker is a sixth: its calls are new-policy
-- enquiries, renewals and premiums due, claims, and changes to a policy,
-- and what its desk must never say is specific to it — a return called
-- guaranteed, a plan recommended, a claim called approved.
--
-- The whole list is restated, so this is safe whether or not 073 has run.
-- ══════════════════════════════════════════════════════════════

alter table voice_profiles
  drop constraint if exists voice_profiles_profile_sku_check;

alter table voice_profiles
  add constraint voice_profiles_profile_sku_check
  check (profile_sku in ('standard', 'clinic', 'real_estate', 'premium', 'heynikki',
                         'education', 'hospital', 'consultancy', 'loan_recovery', 'industry',
                         'insurance'));
