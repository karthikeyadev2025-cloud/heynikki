-- ══════════════════════════════════════════════════════════════
-- 071 — what a Desk call said, kept
--
-- A Desk call left two sentences behind (ai_summary, 066). Nine days of one
-- business's calls could therefore not answer "which kind of business says
-- yes" or "what did the telecaller say on the calls that worked" — the
-- recording had been read once and everything but the summary thrown away.
--
-- ai_transcript
--   The call as spoken, turn by turn: [{ "who": "agent" | "customer",
--   "text": "..." }]. Written by the same model request that writes the
--   summary, so it costs no extra listen.
--
-- ai_facts
--   What the call established: { business_type, speaker, has_website,
--   pitched[], price_quoted, objection, questions[], next_step }. The daily
--   insights (069) count these across two weeks. { "skipped": "<why>" }
--   marks a call whose recording could not be read, so it is not retried.
-- ══════════════════════════════════════════════════════════════

alter table click_to_call_log
  add column if not exists ai_transcript jsonb,
  add column if not exists ai_facts      jsonb;

-- The backfill reads summarised calls that have no facts yet, newest first.
create index if not exists click_to_call_log_facts_todo_idx
  on click_to_call_log (created_at desc)
  where ai_summary is not null and ai_facts is null;
