-- Per-tenant language for the voice agent.
--
-- MUSKAN CLINIC is in Uttar Dinajpur, West Bengal, and its patients were
-- answered in Telugu, because TELUGU_PHONE_PERSONA was applied to every
-- tenant and te-IN was hardcoded into Sarvam STT and TTS. On call d3b61bf3
-- the model opened with "নమస్కారం" — a Bengali ন welded onto a Telugu word,
-- which bulbul cannot pronounce. It knew the context was Bengali; the code
-- gave it no way to act on that.
--
-- Restricted to what Sarvam saaras/bulbul actually serve on this stack AND
-- what the pipeline has a greeting and a persona for. Adding a code here
-- without adding both is how a tenant ends up greeted in a language the
-- rest of the call cannot sustain.
--
-- te-IN keeps the researched register pack. The others get the neutral
-- persona in _neutral_persona(), which is a floor, not a match — any
-- language that takes real volume deserves its own pack.

alter table voice_profiles
  add column if not exists language text not null default 'te-IN';

alter table voice_profiles
  drop constraint if exists voice_profiles_language_check;

alter table voice_profiles
  add constraint voice_profiles_language_check
  check (language in ('te-IN', 'hi-IN', 'bn-IN', 'en-IN'));

comment on column voice_profiles.language is
  'Language Nikki speaks to this tenant''s callers: drives the system prompt, '
  'the spoken greeting, Sarvam STT language_code and bulbul target_language_code.';

-- The tenant this was found on. Its knowledge base gives the address as
-- "Dist. Uttar Dinajpur (W.B)"; Bengali is the language of that district.
-- Left commented deliberately — switching a live tenant's language changes
-- every call they take, so it is the owner's decision, not a migration's.
--
-- update voice_profiles set language = 'bn-IN'
--  where business_name = 'MUSKAN CLINIC';


-- ── Appointments open as 'pending' ───────────────────────────────────────
-- The appointment row is created the moment booking intent appears, before
-- any date or time exists — extracting them mid-call would sit on the
-- caller's critical path. It was being written 'confirmed' regardless, so
-- Nithin's row (call d3b61bf3) sat in the diary as a confirmed appointment
-- with slot_time NULL, indistinguishable from a real one. _enrich_appointment
-- promotes it to 'confirmed' once a date AND a time are actually known.
--
-- Until this runs, main.py detects the rejected insert and falls back to
-- 'confirmed' so bookings are never lost — but it logs CRITICAL every time.

alter table appointments
  drop constraint if exists appointments_status_check;

alter table appointments
  add constraint appointments_status_check
  check (status in ('pending','confirmed','cancelled','completed','no_show','rescheduled'));
