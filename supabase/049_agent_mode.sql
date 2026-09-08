-- ══════════════════════════════════════════════════════════════
-- 049 — how Nikki decides
--
-- Until now every decision on a call came from keyword lists:
-- _detect_intent matched "book"/"అపాయింట్మెంట్" and a booking row was
-- opened, matched "delivery" and it was an order. Keywords cannot tell
-- "book" in "I want to book" from "book" in "the booking I made last
-- week", so each new confusion was fixed by adding another guard.
--
-- 'tools' hands the decision to the model as function calls it can make
-- — check_slot, book_appointment, take_order, check_stock,
-- transfer_to_human, end_call — each wired to the real tables. She can
-- then say "ten o'clock is free" because she looked, not because the
-- prompt implied it.
--
-- Per tenant and defaulting to 'classic' on purpose: this changes the
-- hottest path in the product, and it should prove itself on one
-- business's call_quality scores before it becomes what everyone gets.
-- ══════════════════════════════════════════════════════════════

alter table public.voice_profiles
  add column if not exists agent_mode text not null default 'classic'
    check (agent_mode in ('classic', 'tools'));

comment on column public.voice_profiles.agent_mode is
  'classic = keyword intents (the original path); tools = the model calls '
  'functions wired to the live tables. See voice-pipeline/main.py.';
