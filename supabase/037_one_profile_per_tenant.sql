-- ══════════════════════════════════════════════════════════════
-- 037 — one voice profile per tenant, enforced
--
-- The setup page used to discard its insert result and never set `profile`,
-- so after a successful first save the page still believed the tenant had
-- none. The customer pressed Save again, took the insert branch a second
-- time, and got a duplicate profile. The page code is fixed, but nothing in
-- the database stopped it happening, and the consequence was not cosmetic:
-- the platform's own DID 8633502031 ended up pointing at the duplicate, so
-- calls to the main HeyNikki line were answered as "Nila Everyday
-- Jewellery" until it was found today.
--
-- A profile is the identity a business answers the phone with. Two of them
-- means "which one answers" is decided by whichever row a query happens to
-- return first, which is not a decision anyone made.
--
-- Checked before writing this: no tenant currently holds more than one, so
-- the index builds without cleanup. If a future migration ever fails here,
-- that is the point — it means duplicates came back and something upstream
-- needs fixing rather than the constraint being dropped.
-- ══════════════════════════════════════════════════════════════

create unique index if not exists voice_profiles_one_per_tenant
  on voice_profiles(tenant_id);

comment on index voice_profiles_one_per_tenant is
  'A business answers with exactly one identity. See 037 for why this exists.';
