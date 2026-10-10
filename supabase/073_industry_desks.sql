-- ══════════════════════════════════════════════════════════════
-- 073 — a desk for each kind of business
--
-- voice_profiles.profile_sku picks what Nikki is on the phone: which
-- questions she asks, and what she must never say. It allowed four kinds
-- (standard, clinic, real_estate, premium) plus Hey Nikki's own line, so a
-- college, a hospital, a consultancy, a lender and a factory were all the
-- "standard" receptionist — one that books appointments, and knows nothing
-- about not promising a seat or not naming a debt to a borrower's family.
--
--   education      admissions desk: courses, campus visits, counselling
--   hospital       front desk: OP booking by department, no patient details
--   consultancy    consultations: no advice, no promised outcome
--   loan_recovery  collections: borrower only, no threats, no figures made up
--   industry       front office: sales, service complaints, suppliers
--
-- The prompts are in voice-pipeline/main.py (PROFILE_PROMPTS for calls
-- answered, OUTBOUND_RULES for calls placed). Until this is applied, Setup
-- gets a 400 when one of the new kinds is saved; nothing else changes.
-- ══════════════════════════════════════════════════════════════

alter table voice_profiles
  drop constraint if exists voice_profiles_profile_sku_check;

alter table voice_profiles
  add constraint voice_profiles_profile_sku_check
  check (profile_sku in ('standard', 'clinic', 'real_estate', 'premium', 'heynikki',
                         'education', 'hospital', 'consultancy', 'loan_recovery', 'industry'));
