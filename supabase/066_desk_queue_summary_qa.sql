-- ══════════════════════════════════════════════════════════════
-- 066 — the telecaller's Desk: call summaries and call reviews
--
-- The "next call" queue and scheduled callbacks need no new columns: leads
-- already carry assigned_to and follow_up_at / _note / _done_at /
-- _notified_at (056). This adds what a Desk call leaves behind:
--
--   ai_*   A short summary of the call and a suggested outcome, written by
--          the model from the call recording when the telecaller hangs up.
--          The telecaller confirms or changes it; nothing is saved as the
--          outcome without them.
--   qa_*   The owner's review of a call: 1-5 and a note, which the
--          telecaller sees on their own list.
-- ══════════════════════════════════════════════════════════════

alter table click_to_call_log
  add column if not exists ai_summary       text,
  add column if not exists ai_disposition   text,
  add column if not exists ai_follow_up_at  timestamptz,
  add column if not exists ai_at            timestamptz,
  add column if not exists qa_score         smallint,
  add column if not exists qa_note          text,
  add column if not exists qa_by            uuid,
  add column if not exists qa_at            timestamptz;

alter table click_to_call_log drop constraint if exists click_to_call_log_qa_score_range;
alter table click_to_call_log
  add constraint click_to_call_log_qa_score_range check (qa_score is null or qa_score between 1 and 5);

-- The queue reads open leads per tenant by assignment, score and age.
create index if not exists leads_queue_idx
  on leads (tenant_id, assigned_to, score desc, created_at)
  where stage in ('new', 'contacted', 'qualified');
