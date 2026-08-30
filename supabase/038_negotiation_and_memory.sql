-- ══════════════════════════════════════════════════════════════
-- 038 — what Nikki may negotiate, and what she is allowed to remember
--
-- Two capabilities the product implies and cannot currently do.
--
-- NEGOTIATION. Callers to an Indian small business haggle — it is the normal
-- shape of the conversation, not an edge case. Today Nikki has no idea what
-- she may offer, so she either refuses to engage (and sounds like a form) or
-- improvises a discount the business never agreed to, which is worse: an AI
-- that invents a price is a liability the owner discovers at the counter.
--
-- The policy is per business and deliberately explicit. A floor she may
-- never go under, a maximum discount, and the things she may offer INSTEAD
-- of money — which is what most negotiations actually settle on.
--
-- MEMORY. The owner's browser assistant is read-only: it answers questions
-- about calls and leads and cannot record a single thing it is told. An
-- owner saying "we're closed next Monday" expects that to be remembered.
-- knowledge_base already exists and the phone agent now reads it; this marks
-- which entries came from the owner's own voice so they can be reviewed.
-- ══════════════════════════════════════════════════════════════

alter table voice_profiles
  add column if not exists negotiation jsonb not null default '{}'::jsonb;

comment on column voice_profiles.negotiation is
  'Keys: enabled(bool), floor_note(text - the lowest she may agree to, in the
   business''s own words), max_discount_pct(int 0-100), offers(text[] - what she
   may give instead of a discount), close_line(text). Empty object = she
   declines to negotiate and offers a callback, which is the safe default.';

-- source_type already constrains to faq/document/manual/url. An owner
-- speaking to the browser assistant is 'manual' — the same as typing it —
-- but source_name records that it arrived by voice so the Knowledge page can
-- show where a fact came from and the owner can correct a mishearing.
create index if not exists idx_knowledge_source_name
  on knowledge_base(tenant_id, source_name);
