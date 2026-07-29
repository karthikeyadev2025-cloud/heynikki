-- ══════════════════════════════════════════════════════════════
-- 012 — TELUGU DIALECT REGION
--
-- Telangana and coastal Andhra / Rayalaseema Telugu differ enough that a
-- caller notices within one sentence: verb endings (ఉన్నారు vs ఉన్నరు),
-- everyday vocabulary (ఏమిటి vs ఏంది), and how much Urdu-origin vocabulary
-- is normal. A Warangal caller hearing textbook coastal Telugu registers it
-- immediately as "not from here" — which for a local clinic or shop is
-- exactly the wrong impression.
--
-- This is deliberately a moat: a US-built voice product will never model
-- intra-Telugu regional variation. It costs us one column and some prompt
-- text.
--
-- Defaults to 'neutral' so every existing profile keeps working unchanged
-- until its owner picks a region.
-- ══════════════════════════════════════════════════════════════

alter table voice_profiles
  add column if not exists dialect_region text default 'neutral';

-- Constrain to the regions the prompt layer actually knows about
-- (see TELUGU_DIALECTS in voice-pipeline/app/exotel/bridge.py). Added
-- separately from the column so re-running this migration is safe.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'voice_profiles_dialect_region_check'
  ) then
    alter table voice_profiles
      add constraint voice_profiles_dialect_region_check
      check (dialect_region in ('neutral','andhra','telangana','rayalaseema'));
  end if;
end $$;

comment on column voice_profiles.dialect_region is
  'Telugu regional register for this business. Drives dialect-specific prompt rules.';
