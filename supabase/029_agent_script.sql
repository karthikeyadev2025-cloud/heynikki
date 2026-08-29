-- ══════════════════════════════════════════════════════════════
-- 029 — SCRIPTED AGENT
--
-- Today the prompt decides how Nikki opens a call and what she asks. That
-- is fine until a business has an opinion — and every business does. A
-- clinic wants the patient's name before anything else; a jeweller wants
-- to know repair or purchase; a builder wants the locality first because
-- it decides who calls back.
--
-- Two fields, and deliberately only two:
--
--   greeting_script  the exact opening line, spoken verbatim. Not a
--                    suggestion to the model — the first eight words of a
--                    call are the ones a business is judged on, and they
--                    should not be regenerated on every call.
--   must_ask         questions she has to get answered before the call
--                    ends, in order.
--
-- Not a full flow builder. A branching script that a model has to follow
-- exactly is a worse version of an IVR, and the reason to use a voice
-- agent at all is that a caller can say something the script did not
-- anticipate. This constrains the opening and the required facts, and
-- leaves the conversation between them alone.
-- ══════════════════════════════════════════════════════════════

alter table voice_profiles
  add column if not exists greeting_script text,
  -- ["Caller's name", "Which service", "Preferred day"]
  add column if not exists must_ask jsonb not null default '[]'::jsonb;

comment on column voice_profiles.greeting_script is
  'Spoken verbatim as the first line, after the TRAI disclosure. Null = the agent opens in its own words.';
comment on column voice_profiles.must_ask is
  'Ordered list of questions the agent must get answered before ending the call.';
