-- Allow the "heynikki" profile SKU.
--
-- Hey Nikki's own number (the live demo advertised on heynikki.in) needs a
-- prompt that sells the product, not one that acts as a tenant business. The
-- original CHECK in 001_schema.sql:48 predates that line existing, so the
-- profile is currently routed by business_name in voice-pipeline/main.py
-- (build_system_prompt). Apply this, then set the profile's sku properly and
-- delete that special case.
alter table voice_profiles
  drop constraint if exists voice_profiles_profile_sku_check;

alter table voice_profiles
  add constraint voice_profiles_profile_sku_check
  check (profile_sku in ('standard','clinic','real_estate','premium','heynikki'));
