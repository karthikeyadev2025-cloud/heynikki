-- ══════════════════════════════════════════════════════════════
-- 076 — an imported list is rung in the order it was uploaded
--
-- Telecallers work a list top to bottom. The Desk queue rang the hottest
-- lead first and then the oldest, but an import saves 500 rows in one
-- statement, so all 500 share one created_at and came out in no particular
-- order. On 15 Oct both seats dialled every number by hand from their own
-- sheet instead.
--
--   list_seq   the row's place in the upload: the import's start time in
--              seconds × 100000 + its line, so a later list follows an earlier
--              one and each keeps its own order. Null for leads that did
--              not come from a list.
--
-- Until this is applied imports still work and the queue falls back to the
-- old order.
-- ══════════════════════════════════════════════════════════════

alter table leads add column if not exists list_seq bigint;

-- The queue's "never rung yet, next on the list" read.
create index if not exists leads_list_seq_idx
  on leads (tenant_id, assigned_to, list_seq)
  where last_contacted_at is null and list_seq is not null;
